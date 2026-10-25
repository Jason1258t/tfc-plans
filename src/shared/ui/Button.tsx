import type { ButtonHTMLAttributes } from 'react';
import { cx } from '@/shared/lib';
import styles from './Button.module.css';

type Variant = 'primary' | 'ghost' | 'danger' | 'ai';

/** Карта классов вариантов: явные ссылки, чтобы проверка CSS-модулей видела классы */
const VARIANT: Record<Variant, string> = {
  primary: styles.primary,
  ghost: styles.ghost,
  danger: styles.danger,
  ai: styles.ai,
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Вид: обычная, основная, прозрачная, опасная, «с ИИ» */
  variant?: Variant;
  /** Маленькая */
  size?: 'sm';
  /** Квадратная с одной иконкой */
  icon?: boolean;
}

/** Кнопка сайта: бывший глобальный `.btn` с вариантами. Оформление — Button.module.css. */
export function Button({ variant, size, icon, className, type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      className={cx(
        styles.btn,
        variant && VARIANT[variant],
        size === 'sm' && styles.sm,
        icon && styles.icon,
        className,
      )}
      {...rest}
    />
  );
}
