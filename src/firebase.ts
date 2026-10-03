import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** Без конфига приложение работает в локальном режиме (localStorage) — удобно для разработки */
export const firebaseEnabled = Boolean(config.apiKey && config.projectId);

export const app: FirebaseApp | null = firebaseEnabled ? initializeApp(config) : null;
export const db: Firestore | null = app
  ? initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    })
  : null;

/**
 * Настоящей авторизации нет — ник хранится в куке. Анонимный вход нужен только для того,
 * чтобы правила Firestore могли отсечь запросы не из приложения (request.auth != null).
 */
export const authReady: Promise<void> = app
  ? signInAnonymously(getAuth(app)).then(
      () => undefined,
      (e) => console.warn('Анонимный вход не удался (включите Anonymous в Firebase Auth):', e),
    )
  : Promise.resolve();
