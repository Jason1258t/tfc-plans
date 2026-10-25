import type { SelectHTMLAttributes } from 'react';
import { cx } from '@/shared/lib';
import field from './Field.module.css';

/** Выпадающий список: бывший `select.input` со стрелкой. */
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(field.input, field.select, className)} {...rest}>
      {children}
    </select>
  );
}
