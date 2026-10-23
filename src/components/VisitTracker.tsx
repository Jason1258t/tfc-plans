import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { track, trackView } from '../data/analytics';

/** Статистика: переходы по разделам, открытие задачи (?task=) и гайда (?g=). Ничего не рисует */
export function VisitTracker() {
  const { pathname, search } = useLocation();
  const params = new URLSearchParams(search);
  const tab = params.get('tab') ?? '';
  const sub = params.get('sub') ?? '';
  const task = params.get('task');
  // Гайд в справочнике: ?tab=guides&g=<id>
  const guide = params.get('g');

  useEffect(() => {
    if (pathname !== '/stats') trackView(pathname, search);
    // Остальные параметры (поиск, фильтры) — не новый просмотр
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, tab, sub]);

  useEffect(() => {
    if (task) track('task.open', { id: task });
  }, [task]);

  useEffect(() => {
    if (guide) track('guide.open', { id: guide });
  }, [guide]);

  return null;
}
