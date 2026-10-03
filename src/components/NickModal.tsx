import { useState } from 'react';
import { validateNick } from '../lib/nick';
import { Modal } from './Modal';

interface Props {
  initial?: string;
  onSave: (nick: string) => void;
  onCancel?: () => void;
}

export function NickModal({ initial = '', onSave, onCancel }: Props) {
  const [nick, setNick] = useState(initial);
  const [touched, setTouched] = useState(false);
  const error = validateNick(nick);

  return (
    <Modal onClose={() => onCancel?.()} locked={!onCancel} narrow label="Ник">
      <form
        className="mc-panel stack"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!error) onSave(nick.trim());
        }}
      >
        <h2>Кто ты, путник?</h2>
        <p style={{ margin: 0 }}>
          Ник подписывает задачи и правки. Пароля нет — ник просто запоминается в этом браузере.
        </p>
        <div>
          <label className="mc-label" htmlFor="nick">
            Ник
          </label>
          <input
            id="nick"
            className="mc-input"
            value={nick}
            autoFocus
            maxLength={24}
            placeholder="Steve"
            onChange={(e) => setNick(e.target.value)}
          />
          {touched && error && <div style={{ color: '#a00', marginTop: 4, fontSize: 14 }}>{error}</div>}
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {onCancel && (
            <button type="button" className="mc-btn" onClick={onCancel}>
              Отмена
            </button>
          )}
          <button type="submit" className="mc-btn green">
            Готово
          </button>
        </div>
      </form>
    </Modal>
  );
}
