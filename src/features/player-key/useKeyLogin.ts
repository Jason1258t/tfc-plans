import { useState } from 'react';
import { loginWithKey } from '@/shared/api';

/** Поле ключа игрока: значение, отправка, ошибка для человека */
export function useKeyLogin() {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** true — вошли; пустой ключ — ничего не делает и тоже true */
  const submit = async (): Promise<boolean> => {
    if (!key.trim()) return true;
    setBusy(true);
    setError(null);
    try {
      await loginWithKey(key);
      setKey('');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { key, setKey, busy, error, submit };
}
