import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '@/shared/lib';
import { Button } from '../Button';
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
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className={styles.backdrop}
      aria-label={label ?? (typeof title === 'string' ? title : undefined)}
      onCancel={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!locked) onClose();
      }}
      onMouseDown={(e) => !locked && e.target === e.currentTarget && onClose()}
    >
      <div className={cx(styles.modal, narrow && styles.narrow, wide && styles.wide)}>
        {(title || !locked) && (
          <div className={styles.head}>
            <h2>{title}</h2>
            {actions}
            {!locked && (
              <Button variant="ghost" icon onClick={onClose} aria-label="Закрыть">
                <X size={18} />
              </Button>
            )}
          </div>
        )}
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.foot}>{footer}</div>}
      </div>
    </dialog>,
    document.body,
  );
}
