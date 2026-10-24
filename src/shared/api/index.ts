/** Общий слой API: Firebase, подписки Firestore, состояние синхронизации и аналитика. Снаружи — `@/shared/api`. */
export { app, appCheck, auth, authReady, db, firebaseEnabled } from './firebase';
export { createCollectionStore, type CollectionStore } from './store';
export { clearSyncError, usePendingIds, useSyncStatus, type SyncStatus } from './sync';
export {
  analyticsOff,
  flush,
  purgeExpired,
  setAnalyticsOff,
  track,
  trackView,
  useSearchTrack,
  type Visit,
  type VisitDay,
  type VisitEvent,
} from './analytics';
