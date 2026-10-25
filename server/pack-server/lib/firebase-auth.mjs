/**
 * Проверка токенов Firebase без SDK — тот же уровень защиты, что у правил Firestore:
 * - ID-токен (анонимный вход сайта): RS256, ключи — x509 securetoken@system.gserviceaccount.com,
 *   aud = id проекта, iss = https://securetoken.google.com/<проект>;
 * - токен App Check: RS256, ключи — JWKS firebaseappcheck.googleapis.com,
 *   iss = https://firebaseappcheck.googleapis.com/<номер проекта>, aud содержит projects/<номер проекта>.
 * Ключи кешируются по Cache-Control ответа.
 */
import { createPublicKey, timingSafeEqual, verify } from 'node:crypto';

const ID_TOKEN_KEYS = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const APP_CHECK_KEYS = 'https://firebaseappcheck.googleapis.com/v1/jwks';
const SKEW = 60; // с, расхождение часов

function keyCache(url, parse) {
  let keys = new Map();
  let until = 0;
  let fetchedAt = 0;
  let pending = null;
  const refresh = () =>
    (pending ??= (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Не удалось получить ключи ${url}: ${res.status}`);
      const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
      keys = parse(await res.json());
      fetchedAt = Date.now();
      until = fetchedAt + Math.max(60, maxAge) * 1000;
    })().finally(() => (pending = null)));
  return async function getKey(kid) {
    // Незнакомый kid — ключи могли смениться раньше срока; перезапрашиваем не чаще раза в минуту
    if (Date.now() > until || (!keys.has(kid) && Date.now() - fetchedAt > 60_000)) await refresh();
    return keys.get(kid) ?? null;
  };
}

const idTokenKey = keyCache(
  ID_TOKEN_KEYS,
  (json) => new Map(Object.entries(json).map(([kid, pem]) => [kid, createPublicKey(pem)])),
);
const appCheckKey = keyCache(
  APP_CHECK_KEYS,
  (json) => new Map(json.keys.map((jwk) => [jwk.kid, createPublicKey({ key: jwk, format: 'jwk' })])),
);

const b64json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

async function verifyJwt(token, getKey) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) throw new Error('не JWT');
  const [h, p, s] = parts;
  const header = b64json(h);
  if (header.alg !== 'RS256') throw new Error('неверный алгоритм');
  const key = await getKey(header.kid);
  if (!key) throw new Error('неизвестный ключ');
  if (!verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url')))
    throw new Error('неверная подпись');
  const claims = b64json(p);
  const now = Date.now() / 1000;
  if (!(claims.exp > now - SKEW)) throw new Error('токен истёк');
  if (claims.iat && claims.iat > now + SKEW) throw new Error('токен из будущего');
  return claims;
}

/** Возвращает uid или бросает ошибку */
export async function verifyIdToken(token, projectId) {
  const c = await verifyJwt(token, idTokenKey);
  if (c.aud !== projectId || c.iss !== `https://securetoken.google.com/${projectId}`)
    throw new Error('токен другого проекта');
  if (typeof c.sub !== 'string' || !c.sub) throw new Error('нет пользователя');
  return c.sub;
}

export async function verifyAppCheck(token, projectNumber) {
  const c = await verifyJwt(token, appCheckKey);
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (
    c.iss !== `https://firebaseappcheck.googleapis.com/${projectNumber}` ||
    !aud.includes(`projects/${projectNumber}`)
  )
    throw new Error('токен App Check другого проекта');
  return c.sub; // id приложения
}

export function sameSecret(a, b) {
  if (!a || !b) return false;
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
