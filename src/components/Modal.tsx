import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/util';

interface Props {
  onClose: () => void;
  children: ReactNode;
  narrow?: boolean;
  /** Не закрывать по клику мимо/Esc (например, ввод ника) */
  locked?: boolean;
  label?: string;
}

export function Modal({ onClose, children, narrow, locked, label }: Props) {
  useEffect(() => {
    if (locked) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
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
      <div className={cx('modal', narrow && 'narrow')} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
