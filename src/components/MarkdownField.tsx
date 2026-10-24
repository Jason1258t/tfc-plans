import { Suspense, forwardRef, lazy, type ComponentProps } from 'react';
import type { LiveMarkdownHandle } from './LiveMarkdown';
import { cx } from '@/shared/lib';
import './MarkdownField.css';

const LiveMarkdown = lazy(() => import('./LiveMarkdown'));

type Props = Omit<ComponentProps<typeof LiveMarkdown>, 'ref'> & {
  /** Высота поля в строках, пока текста мало (растёт до maxRows, дальше прокрутка) */
  rows?: number;
  maxRows?: number;
};

/**
 * Поле правки Markdown в формах: живой редактор в рамке, как поле ввода. Только там, где правку включили явно, —
 * для чтения остаётся `Markdown`. Сам редактор грузится отдельным куском при первом показе.
 */
export const MarkdownField = forwardRef<LiveMarkdownHandle, Props>(function MarkdownField(
  { rows = 6, maxRows = 30, className, ...props },
  ref,
) {
  const style = { '--md-field-min': `${rows * 1.6}em`, '--md-field-max': `${maxRows * 1.6}em` } as React.CSSProperties;
  return (
    <div className="md-field" style={style}>
      <Suspense fallback={<div className="md-field-loading faint small">Загрузка редактора…</div>}>
        <LiveMarkdown ref={ref} className={cx('md-field-editor', className)} {...props} />
      </Suspense>
    </div>
  );
});
