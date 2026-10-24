import { create } from 'zustand';
import { createCollectionStore } from '@/shared/api';
import type { Group, NewGroup } from './types';

/** Коллекция групп задач: Firestore `groups` */
export const groupsStore = createCollectionStore<Group, NewGroup>('groups');

interface GroupList {
  items: Group[];
  /** Первый снимок коллекции ещё не пришёл */
  loading: boolean;
  error: string | null;
}

/** Группы задач в порядке, заданном перетаскиванием в левом меню */
export const useGroups = create<GroupList>(() => ({ items: [], loading: true, error: null }));

let stop: (() => void) | null = null;

export function startGroups(): () => void {
  if (stop) return stop;
  const unsub = groupsStore.subscribe(
    (groups) =>
      useGroups.setState({
        items: [...groups].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt),
        loading: false,
        error: null,
      }),
    (e) => useGroups.setState({ loading: false, error: e.message }),
  );
  stop = () => {
    unsub();
    stop = null;
  };
  return stop;
}
