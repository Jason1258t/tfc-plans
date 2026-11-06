import { useState } from 'react';
import { KeyHint, KeyInput, useKeyLogin } from '@/features/player-key';
import { logout, useAccess, useKeyName } from '@/shared/api';
import { validateNick } from '@/shared/lib/nick';
import { Button, Input, Label, Modal } from '@/shared/ui';

interface Props {
  initial?: string;
  onSave: (nick: string) => void;
  onCancel?: () => void;
}

/** Вход на сайт: ник (подпись) и ключ игрока — без ключа сайт только для просмотра */
export function NickDialog({ initial = '', onSave, onCancel }: Props) {
  const [nick, setNick] = useState(initial);
  const [touched, setTouched] = useState(false);
  const access = useAccess();
  const keyName = useKeyName();
  const login = useKeyLogin();
  const error = validateNick(nick);
  const submit = async () => {
    setTouched(true);
    if (error) return;
    // Неверный ключ — остаёмся в окне с ошибкой; пустой — входим без ключа
    if (await login.submit()) onSave(nick.trim());
  };

  return (
    <Modal
      onClose={() => onCancel?.()}
      locked={!onCancel}
      narrow
      title={onCancel ? 'Ник и ключ игрока' : 'Вход на сайт'}
      footer={
        <>
          {access === 'player' && (
            <Button variant="ghost" onClick={() => void logout()}>
              Выйти из ключа
            </Button>
          )}
          <span className="grow" />
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              Отмена
            </Button>
          )}
          <Button variant="primary" disabled={login.busy} onClick={() => void submit()}>
            {login.busy ? 'Проверяю…' : 'Продолжить'}
          </Button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        Ник подписывает задачи и правки и запоминается в этом браузере. Ключ игрока открывает задачи, документы,
        разработку и сохранение правок; без него сайт — только для просмотра.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Label htmlFor="nick">Ник</Label>
        <Input
          id="nick"
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
        <div style={{ marginTop: 12 }}>
          {access === 'player' ? (
            <p className="small" style={{ margin: 0 }}>
              Вы вошли ключом игрока{keyName ? ` «${keyName}»` : ''}.
            </p>
          ) : (
            <KeyInput
              id="nick-key"
              label="Ключ игрока (необязательно)"
              value={login.key}
              onChange={login.setKey}
              error={login.error}
            />
          )}
        </div>
        {/* Enter в поле ключа отправляет форму */}
        <button type="submit" hidden />
      </form>
      {access !== 'player' && <KeyHint />}
    </Modal>
  );
}
