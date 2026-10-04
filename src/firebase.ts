import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
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

/**
 * App Check: Firestore и Gemini принимают запросы только от этого сайта (reCAPTCHA Enterprise,
 * невидимая проверка). Для отладки с чужого домена: VITE_APPCHECK_DEBUG=true и токен из консоли
 * браузера зарегистрировать в Firebase Console → App Check → Manage debug tokens.
 */
const recaptchaKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
if (app && recaptchaKey) {
  // Локальная разработка: заранее зарегистрированный debug-токен (только в dev-сборке, в прод не попадает)
  const debugToken = import.meta.env.DEV ? import.meta.env.VITE_APPCHECK_DEBUG_TOKEN : undefined;
  if (debugToken || import.meta.env.VITE_APPCHECK_DEBUG === 'true') {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      debugToken || true;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(recaptchaKey),
    isTokenAutoRefreshEnabled: true,
  });
}
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
