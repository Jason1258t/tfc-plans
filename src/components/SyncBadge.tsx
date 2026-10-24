import { CloudOff, Clock, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { firebaseEnabled, clearSyncError, useSyncStatus } from '@/shared/api';
import { tooltipHandlers } from '@/shared/ui';

/** Короткая отправка (доли секунды) не показывается — значок только если ждём дольше */
const SENDING_DELAY_MS = 1500;

function plural(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'изменение';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'изменения';
  return 'изменений';
}

/** Значок в шапке: нет связи с базой, изменения ещё не отправлены или сервер их отклонил */
export function SyncBadge() {
  const { state, pendingCount, error, since } = useSyncStatus();
  // Перерисовка, когда отправка затянулась дольше порога
  const [now, setNow] = useState(since);
  useEffect(() => {
    if (state !== 'sending') return;
    const t = setTimeout(() => setNow(Date.now()), SENDING_DELAY_MS);
    return () => clearTimeout(t);
  }, [state, since]);
  const slow = now - since >= SENDING_DELAY_MS;

  if (!firebaseEnabled || state === 'ok' || (state === 'sending' && !slow)) return null;
  const unsent = pendingCount ? `${pendingCount} ${plural(pendingCount)} пока только в этом браузере` : undefined;

  if (state === 'error')
    return (
      <span className="sync-badge bad" role="status" {...tooltipHandlers('Сервер не принял изменения', error)}>
        <TriangleAlert size={14} />
        <span className="hide-sm">ошибка сохранения</span>
        <button className="sync-close" onClick={clearSyncError} aria-label="Скрыть">
          <X size={12} />
        </button>
      </span>
    );
  if (state === 'offline')
    return (
      <span
        className="sync-badge bad"
        role="status"
        {...tooltipHandlers(
          'Нет связи с базой',
          `Показана копия из этого браузера — на других устройствах может быть иначе.${unsent ? ` ${unsent}.` : ''} Проверьте интернет и блокировщики рекламы, обновите страницу.`,
        )}
      >
        <CloudOff size={14} />
        <span className="hide-sm">нет связи</span>
        {pendingCount > 0 && <span className="sync-count">{pendingCount}</span>}
      </span>
    );
  return (
    <span className="sync-badge" role="status" {...tooltipHandlers('Отправка изменений…', unsent)}>
      <Clock size={14} />
      <span className="hide-sm">отправка</span>
    </span>
  );
}
