import type { InputHTMLAttributes } from 'react';
import { cx } from '@/shared/lib';
import field from './Field.module.css';

/** Поле ввода: бывший глобальный `.input`. Вид — Field.module.css. */
export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(field.input, className)} {...rest} />;
}
