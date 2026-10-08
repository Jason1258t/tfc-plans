/**
 * Запись в Firestore из скриптов — через REST от имени залогиненного firebase CLI (`firebase login`),
 * без сервисного ключа. Правила Firestore на такие запросы не действуют (владелец проекта),
 * поэтому скриптами пишутся коллекции, закрытые для сайта: packUpdates, config.
 */
import { execFileSync } from 'node:child_process';
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

export async function token() {
  const require = createRequire(import.meta.url);
  const fbRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
  const auth = require(path.join(fbRoot, 'firebase-tools/lib/auth'));
  const acc = auth.getGlobalDefaultAccount();
  if (!acc) throw new Error('Нужно выполнить firebase login');
  const { access_token } = await auth.getAccessToken(acc.tokens.refresh_token, [
    'https://www.googleapis.com/auth/cloud-platform',
  ]);
  return access_token;
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
