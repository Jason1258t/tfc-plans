import { useState } from 'react';
import { validateNick } from '../lib/nick';
import { Modal } from './Modal';

interface Props {
  initial?: string;
  onSave: (nick: string) => void;
  onCancel?: () => void;
}

export function NickDialog({ initial = '', onSave, onCancel }: Props) {
  const [nick, setNick] = useState(initial);
  const [touched, setTouched] = useState(false);
  const error = validateNick(nick);
  const submit = () => {
    setTouched(true);
    if (!error) onSave(nick.trim());
  };

  return (
    <Modal
      onClose={() => onCancel?.()}
      locked={!onCancel}
      narrow
      title={onCancel ? 'Сменить ник' : 'Как вас зовут в игре?'}
      footer={
        <>
          <span className="grow" />
          {onCancel && (
            <button className="btn ghost" onClick={onCancel}>
              Отмена
            </button>
          )}
          <button className="btn primary" onClick={submit}>
            Продолжить
          </button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        Ник подписывает задачи и правки. Пароля нет — ник просто запоминается в этом браузере.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="label" htmlFor="nick">
          Ник
        </label>
        <input
          id="nick"
          className="input"
          value={nick}
          autoFocus
          maxLength={24}
          placeholder="Steve"
          onChange={(e) => setNick(e.target.value)}
        />
        {touched && error && (
          <div className="small" style={{ color: 'var(--danger)', marginTop: 4 }}>
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}
