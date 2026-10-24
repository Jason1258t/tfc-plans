import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '@/shared/lib';
import styles from './Modal.module.css';

interface Props {
  onClose: () => void;
  children: ReactNode;
  title?: ReactNode;
  /** Кнопки/элементы в шапке справа от заголовка */
  actions?: ReactNode;
  footer?: ReactNode;
  narrow?: boolean;
  /** Широкое окно (каталоги, редакторы) */
  wide?: boolean;
  /** Не закрывать по клику мимо/Esc (например, ввод ника) */
  locked?: boolean;
  label?: string;
}

export function Modal({ onClose, children, title, actions, footer, narrow, wide, locked, label }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => !locked && e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, locked]);

  return createPortal(
    <div className={styles.backdrop} onMouseDown={(e) => !locked && e.target === e.currentTarget && onClose()}>
      <div
        className={cx(styles.modal, narrow && styles.narrow, wide && styles.wide)}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? (typeof title === 'string' ? title : undefined)}
      >
        {(title || !locked) && (
          <div className={styles.head}>
            <h2>{title}</h2>
            {actions}
            {!locked && (
              <button className="btn ghost icon" onClick={onClose} aria-label="Закрыть">
                <X size={18} />
              </button>
            )}
          </div>
        )}
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.foot}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
