import type { ButtonHTMLAttributes } from 'react';
import { cx } from '@/shared/lib';
import styles from './Button.module.css';
import { BUTTON_VARIANT, type ButtonVariant } from './buttonVariant';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Вид: обычная, основная, прозрачная, опасная, «с ИИ» */
  variant?: ButtonVariant;
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
        variant && BUTTON_VARIANT[variant],
        size === 'sm' && styles.sm,
        icon && styles.icon,
        className,
      )}
      {...rest}
    />
  );
}
