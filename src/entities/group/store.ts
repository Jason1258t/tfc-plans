import { createCollectionStore, createLiveList, playerOnly } from '@/shared/api';
import type { Group, NewGroup } from './types';

/** Коллекция групп задач: Firestore `groups` */
export const groupsStore = createCollectionStore<Group, NewGroup>('groups');

/** Группы в порядке бокового меню; подписка общая для всех потребителей; без ключа игрока — пусто. */
export const useGroups = createLiveList<Group>(
  playerOnly((onItems, onError) => groupsStore.subscribe(onItems, onError)),
  (groups) => [...groups].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt),
);
