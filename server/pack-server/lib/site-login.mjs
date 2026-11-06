/**
 * Вход сайта ключом игрока (dev #281). Сайт входит в Firebase анонимно; человек вводит ключ сервера сборки,
 * сервер проверяет ключ и ID-токен этого анонимного входа и ставит пользователю Firebase свои отметки
 * (custom claims) { player: true, keyId, keyName, role }. Правила Firestore и /dev пускают к задачам, документам
 * и правкам только с player. Сам ключ браузер не хранит — отметка живёт на пользователе Firebase.
 *
 * Какие пользователи вошли каким ключом — <DATA_DIR>/site-logins.json [{ uid, keyId, at }]: при отзыве ключа
 * отметки снимаются (уже выданный ID-токен действует до часа — так устроен Firebase).
 * Отметки ставит Identity Toolkit REST (accounts:update) токеном сервисного ключа — тем же, что читает Firestore.
 */
import path from 'node:path';
import { HttpError, readJson, writeJsonAtomic } from './util.mjs';

const TOOLKIT = 'https://identitytoolkit.googleapis.com/v1/projects';
/** Сколько входов помнить: старые анонимные пользователи без браузера всё равно не вернутся */
const MAX_LOGINS = 2000;

export function openSiteLogins(dataDir, { projectId, googleToken }) {
  const file = path.join(dataDir, 'site-logins.json');
  let queue = Promise.resolve();
  /** Правки файла по очереди — два входа одновременно не затирают друг друга */
  const locked = (fn) => (queue = queue.then(fn, fn));

  async function setClaims(uid, claims) {
    let token;
    try {
      token = await googleToken();
    } catch (e) {
      throw new HttpError(503, `Нет доступа к Firebase: ${e.message}`);
    }
    const res = await fetch(`${TOOLKIT}/${projectId}/accounts:update`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: uid, customAttributes: JSON.stringify(claims) }),
    }).catch((e) => {
      throw new HttpError(502, `Firebase Auth недоступен: ${e.cause?.code ?? e.message}`);
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`Firebase Auth ${res.status}: ${body.slice(0, 300)}`);
      throw new HttpError(502, `Firebase Auth ответил ${res.status}`);
    }
  }

  return {
    /** who — ключ ({ id, name, role }), uid — анонимный пользователь сайта */
    async login(who, uid) {
      await setClaims(uid, { player: true, keyId: who.id, keyName: who.name, role: who.role });
      await locked(async () => {
        const list = (await readJson(file, [])).filter((x) => x.uid !== uid);
        list.push({ uid, keyId: who.id, at: new Date().toISOString() });
        await writeJsonAtomic(file, list.slice(-MAX_LOGINS));
      });
      return { name: who.name, role: who.role };
    },

    /** Выход: снять отметки с этого пользователя */
    async logout(uid) {
      await setClaims(uid, {});
      await locked(async () => {
        const list = await readJson(file, []);
        await writeJsonAtomic(
          file,
          list.filter((x) => x.uid !== uid),
        );
      });
    },

    /** Ключ отозван — снять отметки со всех, кто им входил; ошибки Firebase не мешают отзыву */
    async revokeKey(keyId) {
      return locked(async () => {
        const list = await readJson(file, []);
        const mine = list.filter((x) => x.keyId === keyId);
        const left = [];
        for (const x of mine) {
          try {
            await setClaims(x.uid, {});
          } catch (e) {
            console.error(`Вход сайта ${x.uid}: отметки не сняты — ${e.message}`);
            left.push(x);
          }
        }
        await writeJsonAtomic(file, [...list.filter((x) => x.keyId !== keyId), ...left]);
        return { cleared: mine.length - left.length, failed: left.length };
      });
    },
  };
}
