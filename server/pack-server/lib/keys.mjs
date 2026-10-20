/**
 * Ключи доступа: <DATA_DIR>/keys.json — [{ id, name, role, hash, createdAt, createdBy }].
 * Сам ключ нигде не хранится — только sha256 от него (ключ случайный, 256 бит, соль не нужна).
 * Файл правят и сервер, и cli.mjs (первый ключ при установке): сервер перечитывает его, когда меняется mtime.
 */
import { createHash, randomBytes } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { HttpError, readJson, writeJsonAtomic } from './util.mjs';

export const ROLES = ['player', 'admin'];
const NAME_RE = /^[\p{L}\p{N}_ .-]{2,32}$/u;

const hashKey = (key) => createHash('sha256').update(String(key)).digest('hex');

export function openKeys(dataDir) {
  const file = path.join(dataDir, 'keys.json');
  let list = [];
  let byHash = new Map();
  let mtime = null;

  async function load() {
    const st = await fsp.stat(file).catch(() => null);
    const m = st ? `${st.mtimeMs}:${st.size}` : '';
    if (m === mtime) return;
    list = await readJson(file, []);
    byHash = new Map(list.map((k) => [k.hash, k]));
    mtime = m;
  }

  async function save(next) {
    await fsp.mkdir(dataDir, { recursive: true });
    await writeJsonAtomic(file, next);
    mtime = null;
    await load();
  }

  const view = ({ hash: _hash, ...k }) => k;

  return {
    /** { id, name, role } по заголовку Authorization: Bearer <ключ>, иначе null */
    async check(header) {
      const m = /^Bearer (\S+)$/.exec(header ?? '');
      if (!m) return null;
      await load();
      const k = byHash.get(hashKey(m[1]));
      return k ? { id: k.id, name: k.name, role: k.role } : null;
    },

    async list() {
      await load();
      return list.map(view);
    },

    /** Новый ключ; сам ключ возвращается один раз */
    async add(name, role, createdBy) {
      name = String(name ?? '').trim();
      if (!NAME_RE.test(name)) throw new HttpError(400, 'Имя ключа — 2–32 символа: буквы, цифры, пробел, _ . -');
      if (!ROLES.includes(role)) throw new HttpError(400, `Роль — ${ROLES.join(' или ')}`);
      await load();
      const key = `tfc_${randomBytes(32).toString('base64url')}`;
      const rec = {
        id: randomBytes(6).toString('hex'),
        name,
        role,
        hash: hashKey(key),
        createdAt: new Date().toISOString(),
        createdBy,
      };
      await save([...list, rec]);
      return { ...view(rec), key };
    },

    /** Отзыв; последний ключ администратора не отзывается — иначе сервером некому управлять */
    async revoke(id) {
      await load();
      const k = list.find((x) => x.id === id);
      if (!k) throw new HttpError(404, 'Нет такого ключа');
      if (k.role === 'admin' && list.filter((x) => x.role === 'admin').length === 1)
        throw new HttpError(409, 'Это последний ключ администратора — сначала выдайте другой');
      await save(list.filter((x) => x.id !== id));
      return view(k);
    },
  };
}
