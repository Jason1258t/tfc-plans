import { createCollectionStore } from '@/shared/api';
import type { Group, NewGroup } from './types';

/** Коллекция групп задач: Firestore `groups` */
export const groupsStore = createCollectionStore<Group, NewGroup>('groups');
