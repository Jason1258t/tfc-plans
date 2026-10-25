import type { TextareaHTMLAttributes } from 'react';
import { cx } from '@/shared/lib';
import field from './Field.module.css';

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Моноширинный шрифт (id предметов, скрипты) */
  mono?: boolean;
}

/** Многострочное поле: бывший `textarea.input` (+ моноширинный вариант). */
export function Textarea({ mono, className, ...rest }: Props) {
  return <textarea className={cx(field.input, field.textarea, mono && field.textareaMono, className)} {...rest} />;
}
