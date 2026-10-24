import { useEffect } from 'react';
import { startArtifacts } from '@/entities/artifact';
import { startFiles } from '@/entities/file';
import { startGroups } from '@/entities/group';
import { startTasks } from '@/entities/task';
import { startUsers, touchPresence, useNick } from '@/entities/user';

/**
 * Запустить подписки на коллекции и отметку присутствия — один раз на приложение.
 * Состояние живёт в zustand-хранилищах сущностей: страница берёт нужное (`useTasks()`, `useFiles()`…).
 */
export function useStartData() {
  const nick = useNick();
  useEffect(() => {
    if (!nick) return;
    void touchPresence(nick);
    const stops = [startTasks(), startGroups(), startArtifacts(), startUsers(), startFiles()];
    return () => stops.forEach((s) => s());
  }, [nick]);
}
