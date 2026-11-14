/**
 * Отчёты игроков `tfc report` (логи и краш-репорты, пачка — zip) — на сервере сборки (dev #360). Раньше лежали в
 * Firestore (files/{id} с полем report, части — files/{id}/chunks), и вкладки «Краш-репорты»/«Логи» читали всю
 * коллекцию files. Метаданные — <DATA_DIR>/reports.db, содержимое — <DATA_DIR>/reports/<sha256> (одинаковые файлы
 * хранятся один раз). id — 20 символов, как у Firestore: перенесённые отчёты сохраняют id, ссылки
 * `tfc-report:<id>` и `…/dev?report=<id>` не ломаются.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { HttpError, SHA256_RE } from './util.mjs';

// node:sqlite в Node 22 печатает ExperimentalWarning на каждый запуск — глушим только его
const emit = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w).includes('SQLite') ? undefined : emit.call(process, w, ...a));
const { DatabaseSync } = await import('node:sqlite');
process.emitWarning = emit;

export const REPORT_KINDS = ['crash', 'log'];
const TYPE_RE = /^[a-z][a-z0-9-]{0,39}$/;
const NAME_RE = /^[^/\\\0]{1,200}$/;
export const REPORT_ID_RE = /^[A-Za-z0-9]{20}$/;
/** id задачи сайта (Firestore), к которой приложен отчёт */
const TASK_ID_RE = /^[A-Za-z0-9]{1,64}$/;
export const REPORT_MAX = 25 * 1024 * 1024;

const SCHEMA = `
pragma journal_mode = wal;
create table if not exists reports (
  id text primary key,
  name text not null,
  type text not null,
  size integer not null,
  sha256 text not null,
  author text not null,
  created_at integer not null,
  task_id text,
  kind text not null,
  rtype text not null,
  label text not null default '',
  note text not null default '',
  files text not null default '[]'
);
create index if not exists reports_created on reports(created_at);
create index if not exists reports_sha on reports(sha256);
`;

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const newId = () => [...randomBytes(20)].map((b) => ID_CHARS[b % 62]).join('');

/** Ответ в том же виде, что был у Firestore (FileMeta с полем report): сайту и MCP меньше переделок */
const out = (r) => ({
  id: r.id,
  name: r.name,
  type: r.type,
  size: r.size,
  sha256: r.sha256,
  author: r.author,
  createdAt: r.created_at,
  taskId: r.task_id,
  report: {
    kind: r.kind,
    type: r.rtype,
    label: r.label,
    note: r.note,
    files: JSON.parse(r.files),
    source: 'tfc',
  },
});

const mimeOf = (name) =>
  name.endsWith('.zip') ? 'application/zip' : name.endsWith('.gz') ? 'application/gzip' : 'text/plain';

/** maxTotal — все отчёты на диске, minFree — сколько оставить свободным */
export function openReports(dataDir, { maxTotal, minFree }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'reports.db'));
  db.exec(SCHEMA);
  const dir = path.join(dataDir, 'reports');
  fs.mkdirSync(dir, { recursive: true });

  const q = {
    list: db.prepare('select * from reports order by created_at desc, id'),
    listKind: db.prepare('select * from reports where kind = ? order by created_at desc, id'),
    get: db.prepare('select * from reports where id = ?'),
    used: db.prepare('select count(*) c from reports where sha256 = ?'),
    total: db.prepare(
      'select coalesce(sum(size), 0) s from (select sha256, max(size) size from reports group by sha256)',
    ),
    add: db.prepare(
      `insert into reports (id, name, type, size, sha256, author, created_at, task_id, kind, rtype, label, note, files)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    del: db.prepare('delete from reports where id = ?'),
    shas: db.prepare('select distinct sha256 from reports'),
  };
  const blobPath = (sha) => path.join(dir, sha);

  // Файлы без отчёта (упал между записью файла и строки) — убрать
  const keep = new Set(q.shas.all().map((r) => r.sha256));
  for (const n of fs.readdirSync(dir)) if (!keep.has(n)) fs.rmSync(blobPath(n), { force: true, recursive: true });

  function get(id) {
    const r = REPORT_ID_RE.test(id ?? '') ? q.get.get(id) : null;
    if (!r) throw new HttpError(404, `Нет отчёта ${id}`);
    return r;
  }

  /**
   * Новый отчёт. bytes — содержимое целиком (до 25 МБ), meta — { name, kind, type, label, note, files, taskId };
   * админ (перенос из Firestore) может задать id, createdAt, author и sha256 (сверка). Повтор с тем же id и
   * содержимым — «уже есть».
   */
  async function put(bytes, meta, by, { admin = false } = {}) {
    const m = meta && typeof meta === 'object' ? meta : {};
    if (!REPORT_KINDS.includes(m.kind)) throw new HttpError(400, `kind — ${REPORT_KINDS.join(' или ')}`);
    if (!TYPE_RE.test(m.type ?? '')) throw new HttpError(400, 'type — вид отчёта (латиница, -)');
    if (!NAME_RE.test(m.name ?? '')) throw new HttpError(400, 'name — имя файла без папок');
    if (!bytes.length) throw new HttpError(400, 'Пустой файл');
    if (bytes.length > REPORT_MAX) throw new HttpError(413, `Файл больше ${REPORT_MAX / 1024 / 1024} МБ`);
    if (m.taskId != null && !TASK_ID_RE.test(m.taskId)) throw new HttpError(400, 'taskId — id задачи сайта');
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (admin && m.sha256 != null && m.sha256 !== sha)
      throw new HttpError(409, 'Не совпала контрольная сумма — файл повредился при передаче');
    if (admin && m.id != null && !REPORT_ID_RE.test(m.id)) throw new HttpError(400, 'id — 20 букв и цифр');
    const id = admin && m.id ? m.id : newId();
    const existing = q.get.get(id);
    if (existing) {
      if (existing.sha256 !== sha) throw new HttpError(409, `Отчёт ${id} уже есть с другим содержимым`);
      return { report: out(existing), existed: true };
    }
    const files = (Array.isArray(m.files) ? m.files : []).slice(0, 200).map((f) => ({
      name: String(f?.name ?? '').slice(0, 200),
      size: Number.isInteger(f?.size) ? f.size : 0,
      mtime: Number.isInteger(f?.mtime) ? f.mtime : 0,
    }));
    if (!fs.existsSync(blobPath(sha))) {
      if (q.total.get().s + bytes.length > maxTotal)
        throw new HttpError(507, 'Место для отчётов закончилось (REPORTS_MAX_BYTES)');
      const st = await fsp.statfs(dataDir);
      if (st.bavail * st.bsize - bytes.length < minFree) throw new HttpError(507, 'На диске сервера мало места');
      const tmp = `${blobPath(sha)}.${randomBytes(4).toString('hex')}.tmp`;
      await fsp.writeFile(tmp, bytes);
      await fsp.rename(tmp, blobPath(sha));
    }
    const createdAt = admin && Number.isFinite(m.createdAt) ? m.createdAt : Date.now();
    const author = String((admin && m.author) || by).slice(0, 24);
    q.add.run(
      id,
      m.name,
      mimeOf(m.name),
      bytes.length,
      sha,
      author,
      createdAt,
      m.taskId ?? null,
      m.kind,
      m.type,
      String(m.label ?? '').slice(0, 80),
      String(m.note ?? '').slice(0, 500),
      JSON.stringify(files),
    );
    return { report: out(q.get.get(id)), existed: false };
  }

  function remove(id) {
    const r = get(id);
    q.del.run(r.id);
    if (!q.used.get(r.sha256).c) fs.rmSync(blobPath(r.sha256), { force: true });
    return out(r);
  }

  return {
    list: (kind) => (kind ? q.listKind.all(kind) : q.list.all()).map(out),
    get: (id) => out(get(id)),
    path: (id) => {
      const sha = get(id).sha256;
      if (!SHA256_RE.test(sha)) throw new HttpError(500, 'Повреждена запись отчёта');
      return blobPath(sha);
    },
    put,
    remove,
  };
}
