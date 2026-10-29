import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { CustomProvider, getToken, initializeAppCheck, type AppCheck } from 'firebase/app-check';
import { initializeAuth, inMemoryPersistence, updateCurrentUser, type Auth } from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  initializeFirestore,
  memoryLocalCache,
  terminate,
  type Firestore,
} from 'firebase/firestore';

/** Проверяет тот же документ через SDK и REST. Ничего не записывает и не выводит токены. */
export async function diagnoseFirebase(context: {
  app: FirebaseApp | null;
  appCheck: AppCheck | null;
  auth: Auth | null;
  authReady: Promise<void>;
  db: Firestore | null;
}) {
  const log = (stage: string, result: unknown) =>
    console.info('[Firebase: диагностика]', stage, JSON.stringify(result));
  const failure = (error: unknown) => ({
    code: typeof error === 'object' && error && 'code' in error ? String(error.code) : 'unknown',
  });
  await context.authReady;
  const user = context.auth?.currentUser;
  log('Вход', { ready: Boolean(user), anonymous: user?.isAnonymous });
  if (!user || !context.db || !context.app) return;
  let appCheckToken: string | undefined;
  if (context.appCheck) {
    try {
      appCheckToken = (await getToken(context.appCheck, true)).token;
      log('App Check: обновление', { ok: true, length: appCheckToken.length });
    } catch (error) {
      log('App Check: обновление', failure(error));
      return;
    }
  }
  // Зарезервированное отсутствующее имя: проверяем доступ без чтения библиотеки целиком.
  const path = 'schematics/firebase-diagnostic-access-check';
  try {
    const result = await getDocFromServer(doc(context.db, path));
    log('Firestore SDK', { ok: true, exists: result.exists() });
  } catch (error) {
    log('Firestore SDK', failure(error));
  }
  try {
    const idToken = await user.getIdToken(true);
    const headers: Record<string, string> = { Authorization: `Bearer ${idToken}` };
    if (appCheckToken) headers['X-Firebase-AppCheck'] = appCheckToken;
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${context.app.options.projectId}/databases/(default)/documents/${path}`,
      { headers },
    );
    const result = await response.json();
    log('Firestore REST', { status: response.status, code: result.error?.status ?? 'OK' });
  } catch (error) {
    log('Firestore REST', failure(error));
  }
  // Та же учётная запись и тот же App Check, но без общей IndexedDB/ведущей вкладки.
  const probe = initializeApp(context.app.options, `firebase-diagnostic-${Date.now()}`);
  const isolatedDb = initializeFirestore(probe, { localCache: memoryLocalCache() });
  try {
    const isolatedAuth = initializeAuth(probe, { persistence: inMemoryPersistence });
    await updateCurrentUser(isolatedAuth, user);
    if (appCheckToken) {
      const token = appCheckToken;
      initializeAppCheck(probe, {
        provider: new CustomProvider({ getToken: async () => ({ token, expireTimeMillis: Date.now() + 60_000 }) }),
      });
    }
    const result = await getDocFromServer(doc(isolatedDb, path));
    log('Firestore SDK без общего кэша', { ok: true, exists: result.exists() });
  } catch (error) {
    log('Firestore SDK без общего кэша', failure(error));
  } finally {
    await terminate(isolatedDb);
    await deleteApp(probe);
  }
}
