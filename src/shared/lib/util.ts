export const uid = () => crypto.randomUUID().replaceAll('-', '').slice(0, 12);

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'только что';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} дн назад`;
  return new Date(ts).toLocaleDateString('ru-RU');
}

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
