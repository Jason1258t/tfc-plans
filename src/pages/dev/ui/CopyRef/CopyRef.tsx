import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { cx } from '@/shared/lib';
import { tooltipHandlers } from '@/shared/ui';
import styles from './CopyRef.module.css';

/** Текст для агента: по номеру задачу открывает MCP dev_get, название и ссылка — для человека */
export const agentRef = (t: { id: number; title: string }) =>
  `Dev-задача #${t.id} «${t.title}» — dev_get id=${t.id} — ${location.origin}/dev?task=${t.id}`;

/** Кнопка «Скопировать для агента»: номер, название, ссылка */
export function CopyRef({
  task,
  label,
  className,
}: {
  task: { id: number; title: string };
  label?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const text = agentRef(task);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt('Скопируйте вручную:', text);
    }
  };
  return (
    <button
      type="button"
      className={cx(styles.copy, label && styles.withLabel, copied && styles.on, className)}
      onClick={(e) => {
        e.stopPropagation();
        void copy();
      }}
      aria-label={`Скопировать задачу #${task.id} для агента`}
      {...tooltipHandlers(copied ? 'Скопировано' : 'Скопировать для агента', `#${task.id}, название, dev_get и ссылка`)}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {label && <span>{copied ? 'Скопировано' : `#${task.id} для агента`}</span>}
    </button>
  );
}
