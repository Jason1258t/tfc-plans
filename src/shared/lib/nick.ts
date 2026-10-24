const COOKIE = 'tfc_nick';
const YEAR = 60 * 60 * 24 * 365;

export function readNick(): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function writeNick(nick: string) {
  document.cookie = `${COOKIE}=${encodeURIComponent(nick)}; max-age=${YEAR}; path=/; SameSite=Lax`;
}

/** Ограничения как у ника Minecraft, но разрешаем кириллицу */
export function validateNick(nick: string): string | null {
  const n = nick.trim();
  if (n.length < 2) return 'Минимум 2 символа';
  if (n.length > 24) return 'Максимум 24 символа';
  if (!/^[\p{L}\p{N}_\- ]+$/u.test(n)) return 'Только буквы, цифры, _ и -';
  return null;
}
