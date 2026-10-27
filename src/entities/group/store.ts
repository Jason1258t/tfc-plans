import { createCollectionStore, createLiveList } from '@/shared/api';
import type { Group, NewGroup } from './types';

/** Коллекция групп задач: Firestore `groups` */
export const groupsStore = createCollectionStore<Group, NewGroup>('groups');

/** Группы в порядке бокового меню; подписка общая для всех потребителей. */
export const useGroups = createLiveList<Group>(
  (onItems, onError) => groupsStore.subscribe(onItems, onError),
  (groups) => [...groups].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt),
);
