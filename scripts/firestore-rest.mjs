/**
 * Запись в Firestore из скриптов — через REST. Токен — из сервисного ключа, если задан
 * GOOGLE_APPLICATION_CREDENTIALS (сервер сборки), иначе от имени залогиненного firebase CLI (`firebase login`).
 * Правила Firestore на такие запросы не действуют, поэтому скриптами пишутся коллекции, закрытые для сайта:
 * packUpdates, config.
 */
import { execFileSync } from 'node:child_process';
import { createSign } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECT = JSON.parse(fs.readFileSync(path.join(ROOT, '.firebaserc'), 'utf8')).projects.default;
export const SITE = `https://${PROJECT}.web.app`;
export const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

export function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } };
}

export function fromValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('bytesValue' in v) return Buffer.from(v.bytesValue, 'base64');
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(fromValue);
  if ('mapValue' in v)
    return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, fromValue(x)]));
  return null;
}

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

/** Токен по сервисному ключу: JWT RS256 → oauth2 token (grant jwt-bearer), без библиотек Google */
async function serviceAccountToken(file) {
  const key = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!key.client_email || !key.private_key)
    throw new Error(`${file}: это не сервисный ключ (нет client_email/private_key)`);
  const aud = key.token_uri ?? 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT', ...(key.private_key_id ? { kid: key.private_key_id } : {}) })}.${b64url(
    {
      iss: key.client_email,
      scope: SCOPE,
      aud,
      iat: now,
      exp: now + 3600,
    },
  )}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
  const r = await fetch(aud, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sig}`,
    }),
  });
  if (!r.ok) throw new Error(`сервисный ключ: ${r.status} ${(await r.text()).slice(0, 300)}`);
  const { access_token, expires_in } = await r.json();
  return { value: access_token, until: Date.now() + (expires_in ?? 3600) * 1000 - 60_000 };
}

let cached = null;
export async function token() {
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (keyFile) {
    if (!cached || cached.until < Date.now()) cached = await serviceAccountToken(keyFile);
    return cached.value;
  }
  const require = createRequire(import.meta.url);
  const fbRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
  const auth = require(path.join(fbRoot, 'firebase-tools/lib/auth'));
  const acc = auth.getGlobalDefaultAccount();
  if (!acc) throw new Error('Нужно выполнить firebase login');
  const { access_token } = await auth.getAccessToken(acc.tokens.refresh_token, [SCOPE]);
  return access_token;
}

/** Документы config/{id} целиком (PATCH без updateMask — заменяет документ, создаёт, если не было) */
export async function writeConfigDocs(docs) {
  const headers = { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' };
  for (const d of docs) {
    const r = await fetch(`${DOCS}/config/${encodeURIComponent(d.id)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ fields: toValue(d.data).mapValue.fields }),
    });
    if (!r.ok) throw new Error(`Firestore ${r.status} на ${d.id}: ${(await r.text()).slice(0, 300)}`);
  }
}

/** Ник для подписи записей: TFC_NICK или git user.name */
export function deployer(fallback = 'deploy') {
  if (process.env.TFC_NICK) return process.env.TFC_NICK;
  try {
    return execFileSync('git', ['config', 'user.name'], { encoding: 'utf8' }).trim() || fallback;
  } catch {
    return fallback;
  }
}
