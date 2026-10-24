/** Участник сайта (ник — подпись автора в остальных коллекциях). Снаружи — `@/entities/user`. */
export type { SiteUser } from './types';
export { startUsers, subscribeUsers, touchPresence, usePeople, useUsers } from './store';
export { useNick, useSaveNick } from './nick';
