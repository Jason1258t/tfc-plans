import { Suspense, forwardRef, lazy, type ComponentProps } from 'react';
import type { LiveMarkdownHandle } from './LiveMarkdown';
import { cx } from '@/shared/lib';
import styles from './MarkdownField.module.css';

const LiveMarkdown = lazy(() => import('./LiveMarkdown'));

type Props = Omit<ComponentProps<typeof LiveMarkdown>, 'ref'> & {
  /** Высота поля в строках, пока текста мало (растёт до maxRows, дальше прокрутка) */
  rows?: number;
  maxRows?: number;
  /** Класс внешней рамки поля — когда высоту задаёт тот, кто его ставит (редактор гайда) */
  wrapperClassName?: string;
};

/**
 * Поле правки Markdown в формах: живой редактор в рамке, как поле ввода. Только там, где правку включили явно, —
 * для чтения остаётся `Markdown`. Сам редактор грузится отдельным куском при первом показе.
 */
export const MarkdownField = forwardRef<LiveMarkdownHandle, Props>(function MarkdownField(
  { rows = 6, maxRows = 30, className, wrapperClassName, ...props },
  ref,
) {
  const style = { '--md-field-min': `${rows * 1.6}em`, '--md-field-max': `${maxRows * 1.6}em` } as React.CSSProperties;
  return (
    <div className={cx(styles.mdField, wrapperClassName)} style={style}>
      <Suspense fallback={<div className={cx(styles.mdFieldLoading, 'faint small')}>Загрузка редактора…</div>}>
        <LiveMarkdown ref={ref} className={cx(styles.mdFieldEditor, className)} {...props} />
      </Suspense>
    </div>
  );
});
