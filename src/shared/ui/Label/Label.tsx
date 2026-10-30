import type { HTMLAttributes, LabelHTMLAttributes, ReactNode } from 'react';
import { cx } from '@/shared/lib';
import styles from './Label.module.css';

interface BaseProps {
  children?: ReactNode;
  className?: string;
}

type Props = BaseProps &
  (
    | ({ htmlFor: string } & LabelHTMLAttributes<HTMLLabelElement>)
    | ({ htmlFor?: undefined } & HTMLAttributes<HTMLSpanElement>)
  );

/** Подпись поля: с `htmlFor` рисуется как <label>, без него — как <span> */
export function Label({ htmlFor, className, children, ...rest }: Props) {
  if (htmlFor) {
    return (
      <label
        className={cx(styles.label, className)}
        htmlFor={htmlFor}
        {...(rest as LabelHTMLAttributes<HTMLLabelElement>)}
      >
        {children}
      </label>
    );
  }
  return (
    <span className={cx(styles.label, className)} {...(rest as HTMLAttributes<HTMLSpanElement>)}>
      {children}
    </span>
  );
}
