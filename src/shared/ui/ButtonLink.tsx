import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router';
import { cx } from '@/shared/lib';
import { BUTTON_VARIANT, type ButtonVariant } from './buttonVariant';
import styles from './Button/Button.module.css';

interface Props extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** Внутренняя ссылка сайта: рисуется через <Link> */
  to?: string;
  /** Внешняя ссылка или файл: рисуется через <a> */
  href?: string;
  /** Вид: как у Button */
  variant?: ButtonVariant;
  /** Маленькая */
  size?: 'sm';
  /** Квадратная с одной иконкой */
  icon?: boolean;
  children?: ReactNode;
}

/**
 * Ссылка, которая выглядит кнопкой (бывший `<a className="btn">`).
 * Отдельный компонент, потому что у `Button` семантика <button>; здесь сохраняется
 * переход по ссылке и его атрибуты (target, rel, download).
 */
export function ButtonLink({ to, href, variant, size, icon, className, children, ...rest }: Props) {
  const cls = cx(
    styles.btn,
    variant && BUTTON_VARIANT[variant],
    size === 'sm' && styles.sm,
    icon && styles.icon,
    className,
  );
  if (to) {
    return (
      <Link to={to} className={cls} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={cls} {...rest}>
      {children}
    </a>
  );
}
