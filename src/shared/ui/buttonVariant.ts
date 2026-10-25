import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'ai';

/** Карта классов вариантов: явные ссылки, чтобы проверка CSS-модулей видела классы */
export const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: styles.primary,
  ghost: styles.ghost,
  danger: styles.danger,
  ai: styles.ai,
};
