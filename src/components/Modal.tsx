import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/util';

interface Props {
  onClose: () => void;
  children: ReactNode;
  title?: ReactNode;
  /** Кнопки/элементы в шапке справа от заголовка */
  actions?: ReactNode;
  footer?: ReactNode;
  narrow?: boolean;
  /** Не закрывать по клику мимо/Esc (например, ввод ника) */
  locked?: boolean;
  label?: string;
}

export function Modal({ onClose, children, title, actions, footer, narrow, locked, label }: Props) {
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
    <div className="modal-backdrop" onMouseDown={(e) => !locked && e.target === e.currentTarget && onClose()}>
      <div
        className={cx('modal', narrow && 'narrow')}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? (typeof title === 'string' ? title : undefined)}
      >
        {(title || !locked) && (
          <div className="modal-head">
            <h2>{title}</h2>
            {actions}
            {!locked && (
              <button className="btn ghost icon" onClick={onClose} aria-label="Закрыть">
                <X size={18} />
              </button>
            )}
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
