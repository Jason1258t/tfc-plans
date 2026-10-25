import { cx } from '@/shared/lib';
import styles from './Importance.module.css';

interface DotProps {
  /** Цвет важности — приходит из данных задачи, поэтому инлайном */
  color: string;
  className?: string;
}

/** Точка важности (цвет — из данных) */
export function ImpDot({ color, className }: DotProps) {
  return <span className={cx(styles.dot, className)} style={{ background: color }} />;
}

interface PillProps extends DotProps {
  children?: React.ReactNode;
  title?: string;
}

/** Кружок важности с подписью и цветом из данных задачи */
export function ImpPill({ color, className, children, title }: PillProps) {
  return (
    <span className={cx(styles.pill, className)} style={{ color }} title={title}>
      {children}
    </span>
  );
}
