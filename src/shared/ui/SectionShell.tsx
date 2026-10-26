import type { ReactNode } from 'react';
import { cx } from '@/shared/lib';
import styles from './SectionShell.module.css';

interface Props {
  /** Кнопки меню подраздела */
  nav: ReactNode;
  /** Подпись меню для скринридера */
  navLabel: string;
  /** Содержимое справа — прямые дети сетки, у каждого min-width: 0 */
  children: ReactNode;
}

/** Каркас «меню слева, содержимое справа»; на телефоне меню уходит наверх и переносится строками */
export function SectionShell({ nav, navLabel, children }: Props) {
  return (
    <div className={styles.shell}>
      {/* botany-nav — цель шагов знакомства (lib/onboarding.ts), не стиль */}
      <nav className={cx(styles.nav, 'botany-nav')} aria-label={navLabel}>
        {nav}
      </nav>
      {children}
    </div>
  );
}
