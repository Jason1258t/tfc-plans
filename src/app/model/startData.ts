import { useEffect } from 'react';
import { touchPresence, useNick } from '@/entities/user';

/** Отметить присутствие после выбора или смены ника; данные загружают потребители сущностей. */
export function useStartData() {
  const nick = useNick();
  useEffect(() => {
    if (nick) void touchPresence(nick);
  }, [nick]);
}
