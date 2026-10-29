/**
 * Контент сайта для `tfc pull`: датапаки «Ставить в мир», скрипты KubeJS «Ставить на сервер», схемы библиотеки
 * и исходники схем. Сайт закрыт App Check, поэтому программа берёт всё здесь, а сервер читает Firestore REST
 * сервисным ключом (GOOGLE_APPLICATION_CREDENTIALS; без него — от имени `firebase login`, это для разработки).
 *
 * Доступ к Firestore — scripts/firestore-rest.mjs из копии репозитория (той же, что собирает данные): сервер
 * в /opt/tfc-pack без scripts/. Бюджет бесплатного тарифа — 50 тыс. чтений в сутки на всех, поэтому списки
 * кешируются на SITE_CACHE_SEC (по умолчанию 5 минут), а файлы схем — на диске навсегда (файл с данным id
 * не меняется: правка схемы на сайте — новый файл).
 *
 * Аддоны: карточки tools/<мод>/addon.json из той же копии репозитория + версии из Firestore addonVersions
 * (src/lib/addonVersions.ts); jar версий — блобы этого сервера по sha256 (/blobs/<sha256>).
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HttpError } from './util.mjs';
import { inspectSchematic } from './schematic-nbt.mjs';

/** Поля схем без превью (до 280 тыс. знаков картинки на запись программе не нужны) */
const SCHEMATIC_FIELDS = [
  'name',
  'fileName',
  'fileId',
  'fileSize',
  'size',
  'blocks',
  'replace',
  'shape',
  'description',
  'author',
  'updatedBy',
  'updatedAt',
  'createdAt',
  'contentHash',
  'sha256',
  'uploadedBy',
];
const FILE_ID_RE = /^[A-Za-z0-9]{1,64}$/;
const ADDON_ID_RE = /^[a-z][a-z0-9_]{1,63}$/;
const VERSION_RE = /^[0-9][\w.+-]{0,39}$/;
const JAR_RE = /^[\w.+-]+\.jar$/;
/** Отчёты tfc report: размер и кусок — как у сайта (src/lib/files.config.ts) */
const REPORT_KINDS = ['crash', 'log'];
const REPORT_TYPE_RE = /^[a-z][a-z0-9-]{0,39}$/;
const REPORT_NAME_RE = /^[^/\\\0]{1,200}$/;
const REPORT_MAX = 25 * 1024 * 1024;
const REPORT_CHUNK = 700 * 1024;
const ID_ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** id документа как у Firestore: 20 знаков */
const randomId = () => [...randomBytes(20)].map((b) => ID_ABC[b % ID_ABC.length]).join('');

export function openSite(dataDir, { repoDir, ttlMs = 5 * 60_000, docsUrl }) {
  const filesDir = path.join(dataDir, 'site-files');
  let rest = null;

  async function firestore() {
    if (rest) return rest;
    const file = path.join(repoDir, 'scripts', 'firestore-rest.mjs');
    if (!fs.existsSync(file))
      throw new HttpError(
        503,
        'Нет копии репозитория сайта — она появляется после первой сборки (POST /admin/rebuild)',
      );
    const m = await import(pathToFileURL(file).href);
    let tok = null;
    let refreshing = null;
    rest = {
      docs: docsUrl || m.DOCS,
      fromValue: m.fromValue,
      toValue: m.toValue,
      async auth(rejected) {
        // Поздний 401 от старого запроса не сбрасывает уже обновлённый токен.
        const fresh = rejected !== undefined && tok?.value === rejected;
        if (fresh) tok = null;
        if (!tok || tok.until < Date.now()) {
          if (!refreshing) {
            refreshing = (async () => {
              try {
                tok = { value: await m.token({ fresh }), until: Date.now() + 45 * 60_000 };
                return tok.value;
              } finally {
                refreshing = null;
              }
            })();
          }
          return refreshing;
        }
        return tok.value;
      },
    };
    return rest;
  }

  async function api(url, init = {}) {
    const fsr = await firestore();
    let res;
    try {
      const send = (value) =>
        fetch(fsr.docs + url, {
          ...init,
          headers: { Authorization: `Bearer ${value}`, 'Content-Type': 'application/json' },
        });
      const value = await fsr.auth();
      res = await send(value);
      if (res.status === 401) {
        await res.body?.cancel();
        res = await send(await fsr.auth(value));
      }
    } catch (e) {
      throw new HttpError(502, `Firestore недоступен: ${e.cause?.code ?? e.message}`);
    }
    if (res.status === 404) return null;
    // Условие записи не выполнено (документ изменили после чтения)
    if ([400, 409].includes(res.status) && /FAILED_PRECONDITION|ABORTED|ALREADY_EXISTS/.test(await res.clone().text()))
      throw new HttpError(409, 'Правку изменили после чтения — посмотрите список ещё раз');
    if (!res.ok) {
      const body = await res.text();
      console.error(`Firestore ${res.status} ${url}: ${body.slice(0, 300)}`);
      throw new HttpError(502, `Firestore ответил ${res.status}`);
    }
    return res.json();
  }

  const fields = (fsr, d) => Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, fsr.fromValue(v)]));

  async function listAll(collection, mask) {
    const fsr = await firestore();
    const out = [];
    let pageToken = '';
    const m = mask ? mask.map((f) => `&mask.fieldPaths=${f}`).join('') : '';
    do {
      const r = await api(`/${collection}?pageSize=300${m}${pageToken ? `&pageToken=${pageToken}` : ''}`);
      for (const d of r?.documents ?? [])
        out.push({ id: d.name.split('/').pop(), revision: d.updateTime, ...fields(fsr, d) });
      pageToken = r?.nextPageToken ?? '';
    } while (pageToken);
    return out;
  }

  /** Список коллекции из кеша; ошибка не кешируется */
  const cache = new Map();
  async function cached(collection, mask) {
    const c = cache.get(collection);
    if (c && c.until > Date.now()) return c.value;
    const value = listAll(collection, mask);
    cache.set(collection, { until: Date.now() + ttlMs, value });
    try {
      return await value;
    } catch (e) {
      cache.delete(collection);
      throw e;
    }
  }

  /** Отмеченные (install) + названные по имени или id (любые, в т. ч. тестовые); неизвестные имена — в unknown */
  function pick(list, names, nameOf) {
    const want = names.map((n) => n.trim()).filter(Boolean);
    const found = new Set();
    const unknown = [];
    for (const n of want) {
      const low = n.toLowerCase();
      const hits = list.filter((x) => x.id === n || nameOf(x).toLowerCase() === low);
      if (!hits.length) unknown.push(n);
      for (const h of hits) found.add(h);
    }
    const items = want.length ? [...found] : list.filter((x) => x.install === true);
    return {
      items,
      unknown,
      all: list.map((x) => ({ id: x.id, name: nameOf(x), install: x.install === true })),
    };
  }

  async function datapacks(names) {
    const list = await cached('datapacks');
    return pick(list, names, (d) => d.name ?? '');
  }

  async function kubejs(names) {
    const list = await cached('kubejsScripts');
    return pick(list, names, (s) => s.fileName ?? '');
  }

  async function schematics() {
    return { items: await cached('schematics', SCHEMATIC_FIELDS) };
  }

  /** Исходник схемы: files/{id} + files/{id}/chunks/{n} (пакет firestore-files) → диск; только файлы схем */
  async function filePath(id) {
    if (!FILE_ID_RE.test(id)) throw new HttpError(400, 'Неверный id файла');
    const target = path.join(filesDir, id);
    if (fs.existsSync(target)) return target;
    const { items } = await schematics();
    if (!items.some((s) => s.fileId === id)) throw new HttpError(404, 'Нет такого файла схемы');
    const fsr = await firestore();
    const meta = await api(`/files/${id}`);
    if (!meta) throw new HttpError(404, 'Файл схемы удалён с сайта');
    const f = fields(fsr, meta);
    if (!f.complete) throw new HttpError(409, 'Файл схемы ещё загружается на сайт');
    const parts = [];
    let pageToken = '';
    do {
      const r = await api(`/files/${id}/chunks?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`);
      for (const d of r?.documents ?? []) {
        const c = fields(fsr, d);
        parts.push({ i: Number(c.i ?? d.name.split('/').pop()), data: c.data });
      }
      pageToken = r?.nextPageToken ?? '';
    } while (pageToken);
    parts.sort((a, b) => a.i - b.i);
    if (parts.length !== f.chunks || parts.some((p, i) => p.i !== i || !Buffer.isBuffer(p.data)))
      throw new HttpError(502, `Файл схемы ${id} в Firestore неполный (${parts.length} из ${f.chunks} частей)`);
    const bytes = Buffer.concat(parts.map((p) => p.data));
    if (f.sha256 && createHash('sha256').update(bytes).digest('hex') !== f.sha256)
      throw new HttpError(502, `Файл схемы ${id}: хеш не сошёлся`);
    await fsp.mkdir(filesDir, { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, bytes);
    await fsp.rename(tmp, target);
    return target;
  }

  // Очередь не даёт двум публикациям на одном сервере проверить один и тот же старый кеш.
  let schematicWrite = Promise.resolve();
  function publishSchematic(bytes, meta, who) {
    const next = schematicWrite.then(() => saveSchematic(bytes, meta, who));
    schematicWrite = next.catch(() => {});
    return next;
  }

  async function saveSchematic(bytes, meta, who) {
    const m = meta ?? {};
    if (m.id != null && !FILE_ID_RE.test(m.id)) throw new HttpError(400, 'Неверный id схемы');
    // oxlint-disable-next-line no-control-regex -- имена файлов не содержат управляющих символов
    if (typeof m.fileName !== 'string' || !/^[^/\\\x00-\x1f]{1,180}\.nbt$/i.test(m.fileName))
      throw new HttpError(400, 'Нужно имя .nbt без папок');
    if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 120)
      throw new HttpError(400, 'Название схемы — от 1 до 120 символов');
    if (m.author != null && (typeof m.author !== 'string' || !m.author.trim() || m.author.length > 24))
      throw new HttpError(400, 'Автор — от 1 до 24 символов');
    if (!m.id && who.role !== 'admin' && m.author && m.author !== who.name && m.author !== 'Неизвестен')
      throw new HttpError(403, 'Указать другого автора может хост');
    if (m.sourceOwner != null && (typeof m.sourceOwner !== 'string' || m.sourceOwner.length > 80))
      throw new HttpError(400, 'Неверный владелец копии');
    if (m.sourceOwner && m.sourceOwner !== who.name && who.role !== 'admin')
      throw new HttpError(403, 'Публиковать uploaded-копию другого игрока может хост');
    let info;
    try {
      info = inspectSchematic(bytes);
    } catch (e) {
      throw new HttpError(400, `Неверная схема: ${e.message}`);
    }
    const fsr = await firestore();
    const toFields = (data) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, fsr.toValue(v)]));
    const current = m.id ? await api(`/schematics/${m.id}`) : null;
    if (m.id && !current) throw new HttpError(404, 'Схема удалена');
    const old = current ? fields(fsr, current) : null;
    if (old) {
      if (who.role !== 'admin' && old.uploadedByKeyId !== who.id && old.author !== who.name)
        throw new HttpError(403, 'Обновлять схему может её автор или хост');
      if (!m.revision || m.revision !== current.updateTime) {
        cache.delete('schematics');
        throw new HttpError(409, 'Схему изменили — посмотрите её заново');
      }
    }
    cache.delete('schematics');
    const { items } = await schematics();
    for (const entry of items) {
      // Старые записи ещё без хеша: сравниваем сохранённые исходники, а не имя файла.
      const source = await fsp.readFile(await filePath(entry.fileId));
      let existing;
      try {
        existing = inspectSchematic(source);
      } catch {
        continue;
      }
      if (existing.contentHash !== info.contentHash && !m.asSource) {
        const { schematicFromLibrary } = await import(
          pathToFileURL(path.join(repoDir, 'src/lib/schematicFile.ts')).href
        );
        const edited = inspectSchematic(await schematicFromLibrary(source, { ...entry, replace: entry.replace ?? [] }));
        if (edited.contentHash === info.contentHash)
          throw new HttpError(409, 'Это обработанная копия из библиотеки — нужен явный --as-source');
      }
      if (existing.contentHash === info.contentHash) {
        if (entry.id === m.id) return { id: entry.id, unchanged: true, revision: current.updateTime };
        throw new HttpError(409, `Эта схема уже в библиотеке: ${entry.name} (${entry.id})`);
      }
    }
    const id = m.id ?? randomId();
    const fileId = randomId();
    const now = Date.now();
    const chunks = Math.ceil(bytes.length / REPORT_CHUNK);
    const fileUrl = `/files/${fileId}`;
    const cleanup = async () => {
      for (let i = 0; i < chunks; i++) await api(`${fileUrl}/chunks/${i}`, { method: 'DELETE' }).catch(() => {});
      await api(fileUrl, { method: 'DELETE' }).catch(() => {});
    };
    await api(`${fileUrl}?currentDocument.exists=false`, {
      method: 'PATCH',
      body: JSON.stringify({
        fields: toFields({
          name: m.fileName,
          size: bytes.length,
          type: 'application/octet-stream',
          chunks,
          complete: false,
          createdAt: now,
          sha256: info.sha256,
          author: who.name,
          taskId: null,
        }),
      }),
    });
    try {
      for (let i = 0; i < chunks; i++)
        await api(`${fileUrl}/chunks/${i}`, {
          method: 'PATCH',
          body: JSON.stringify({
            fields: {
              i: { integerValue: String(i) },
              data: { bytesValue: bytes.subarray(i * REPORT_CHUNK, (i + 1) * REPORT_CHUNK).toString('base64') },
            },
          }),
        });
      const data = {
        fileId,
        fileSize: bytes.length,
        size: info.size,
        blocks: info.blocks,
        contentHash: info.contentHash,
        sha256: info.sha256,
        updatedBy: who.name,
        updatedAt: now,
        ...(old ? {} : { uploadedBy: who.name, uploadedByKeyId: who.id, sourceOwner: m.sourceOwner ?? null }),
        ...(old
          ? { preview: '' }
          : {
              name: m.name.trim(),
              fileName: m.fileName,
              author: m.author ?? 'Неизвестен',
              replace: [],
              createdAt: now,
            }),
      };
      const fullName = (suffix) => `${fsr.docs.replace(/^.*\/v1\//, '')}${suffix}`;
      // Файл становится доступным одновременно с карточкой; ревизия защищает и от правки в браузере.
      const result = await api(':commit', {
        method: 'POST',
        body: JSON.stringify({
          writes: [
            {
              update: { name: fullName(fileUrl), fields: { complete: { booleanValue: true } } },
              updateMask: { fieldPaths: ['complete'] },
            },
            {
              update: { name: fullName(`/schematics/${id}`), fields: toFields(data) },
              ...(old ? { updateMask: { fieldPaths: Object.keys(data) } } : {}),
              currentDocument: old ? { updateTime: m.revision } : { exists: false },
            },
          ],
        }),
      });
      cache.delete('schematics');
      return {
        id,
        fileId,
        revision: result.writeResults?.[1]?.updateTime,
        url: 'https://tfc-plans-fd2c.web.app/schematics',
      };
    } catch (e) {
      cache.delete('schematics');
      // При потере ответа commit мог завершиться: не удаляем файл, если карточка уже ссылается на него.
      const saved = await api(`/schematics/${id}`).catch(() => undefined);
      if (saved && fields(fsr, saved).fileId === fileId) {
        cache.delete('schematics');
        return { id, fileId, revision: saved.updateTime };
      }
      if (saved !== undefined) await cleanup();
      throw e;
    }
  }

  /**
   * Правки конфигов от агента (configChanges, пишет MCP config_propose) — для tfc admin changes. Без кеша:
   * хост смотрит редко, а после применения список должен сразу показать итог. updateTime — для условной записи.
   */
  async function configChanges() {
    const fsr = await firestore();
    const out = [];
    let pageToken = '';
    do {
      const r = await api(`/configChanges?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`);
      for (const d of r?.documents ?? [])
        out.push({ id: d.name.split('/').pop(), updateTime: d.updateTime, ...fields(fsr, d) });
      pageToken = r?.nextPageToken ?? '';
    } while (pageToken);
    return out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }

  /** Итог правки от хоста: status applied | rejected, results [{ key, ok, msg }]; только если её не меняли */
  async function setConfigChange(id, { status, results, updateTime }, by) {
    if (!FILE_ID_RE.test(id)) throw new HttpError(400, 'Неверный id правки');
    if (!['applied', 'rejected'].includes(status)) throw new HttpError(400, 'status — applied или rejected');
    if (typeof updateTime !== 'string' || !updateTime) throw new HttpError(400, 'нужен updateTime из списка');
    const list = Array.isArray(results) ? results.slice(0, 200) : [];
    const data = {
      status,
      appliedAt: Date.now(),
      appliedBy: String(by).slice(0, 80),
      results: list.map((r) => ({
        path: String(r?.path ?? '').slice(0, 300),
        key: String(r?.key ?? '').slice(0, 300),
        ok: r?.ok === true,
        msg: String(r?.msg ?? '').slice(0, 500),
      })),
    };
    const fsr = await firestore();
    const mask = Object.keys(data)
      .map((k) => `updateMask.fieldPaths=${k}`)
      .join('&');
    const d = await api(`/configChanges/${id}?${mask}&currentDocument.updateTime=${encodeURIComponent(updateTime)}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, fsr.toValue(v)])) }),
    });
    if (!d) throw new HttpError(404, 'Нет такой правки');
    return { id, updateTime: d.updateTime, ...data };
  }

  /** Карточки аддонов из копии репозитория (tools/<мод>/addon.json) */
  function addonCards() {
    const tools = path.join(repoDir, 'tools');
    if (!fs.existsSync(tools)) return [];
    const out = [];
    for (const d of fs.readdirSync(tools, { withFileTypes: true })) {
      const f = path.join(tools, d.name, 'addon.json');
      if (!d.isDirectory() || !fs.existsSync(f)) continue;
      try {
        out.push(JSON.parse(fs.readFileSync(f, 'utf8')));
      } catch (e) {
        console.error(`карточка ${f}: ${e.message}`);
      }
    }
    return out;
  }

  /**
   * Аддоны для tfc pull: карточка (кому ставить, что заменяет) + версии с jar на этом сервере. Черновики тоже —
   * программа ставит их, только если версию назвали явно. Аддон без карточки (unlisted, tp_trace) не отдаётся.
   */
  async function addons() {
    const versions = await cached('addonVersions');
    const out = [];
    for (const c of addonCards()) {
      if (c.unlisted || !ADDON_ID_RE.test(c.id ?? '')) continue;
      const list = versions
        .filter((v) => v.addon === c.id && v.jar?.sha256)
        .map((v) => ({
          version: v.version,
          date: v.date ?? '',
          status: v.status ?? 'draft',
          file: v.jar.file,
          sha256: v.jar.sha256,
          size: v.jar.size,
        }));
      out.push({
        id: c.id,
        name: c.name,
        side: c.side,
        hostOnly: c.hostOnly === true,
        needs: c.needs,
        replaces: c.replaces ?? [],
        formerIds: c.formerIds ?? [],
        versions: list,
      });
    }
    return { addons: out };
  }

  /**
   * Залитый jar версии аддона → addonVersions/{мод}@{версия}: новой версии — запись-черновик (ченджлог пишут потом,
   * на сайте или MCP addon_version_put), у существующей без jar — jar. Другой jar под той же версией — отказ.
   */
  async function registerAddonVersion({ addon, version, file, sha256, size }, by) {
    if (!ADDON_ID_RE.test(addon ?? '')) throw new HttpError(400, 'addon — id мода (латиница, цифры, _)');
    if (!VERSION_RE.test(version ?? '')) throw new HttpError(400, 'version — номер версии (2.3.3)');
    if (!JAR_RE.test(file ?? '')) throw new HttpError(400, 'file — имя jar без папок');
    if (!Number.isInteger(size) || size <= 0) throw new HttpError(400, 'size — размер jar');
    const fsr = await firestore();
    const id = `${addon}@${version}`;
    const url = `/addonVersions/${encodeURIComponent(id)}`;
    const jar = { file, sha256, size };
    const toFields = (data) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, fsr.toValue(v)]));
    const cur = await api(url);
    let created = false;
    if (!cur) {
      const now = Date.now();
      await api(`${url}?currentDocument.exists=false`, {
        method: 'PATCH',
        body: JSON.stringify({
          fields: toFields({
            addon,
            version,
            date: new Date().toISOString().slice(0, 10),
            status: 'draft',
            jar,
            changelog: '',
            checked: 'none',
            checkedNote: '',
            createdAt: now,
            updatedAt: now,
            updatedBy: String(by).slice(0, 24),
          }),
        }),
      });
      created = true;
    } else {
      const old = fields(fsr, cur).jar;
      if (old?.sha256 && old.sha256 !== sha256)
        throw new HttpError(409, `У ${id} уже другой jar (${old.sha256.slice(0, 12)}…) — поднимите номер версии`);
      if (!old?.sha256)
        await api(`${url}?updateMask.fieldPaths=jar&currentDocument.updateTime=${encodeURIComponent(cur.updateTime)}`, {
          method: 'PATCH',
          body: JSON.stringify({ fields: toFields({ jar }) }),
        });
    }
    cache.delete('addonVersions');
    return { id, created, jar };
  }

  /**
   * Отчёт из tfc report (лог, краш-репорт; пачка — zip) → хранилище файлов сайта (files/{id} + chunks, формат
   * firestore-files): на сайте — «Документы» → «Краш-репорты»/«Логи», агенту — MCP report_get id=<id>.
   * Пишем как клиент пакета: метаданные с complete: false, части, потом complete: true; сбой — убираем за собой.
   */
  async function uploadReport(bytes, meta, by) {
    const m = meta && typeof meta === 'object' ? meta : {};
    if (!REPORT_KINDS.includes(m.kind)) throw new HttpError(400, `kind — ${REPORT_KINDS.join(' или ')}`);
    if (!REPORT_TYPE_RE.test(m.type ?? '')) throw new HttpError(400, 'type — вид отчёта (латиница, -)');
    if (!REPORT_NAME_RE.test(m.name ?? '')) throw new HttpError(400, 'name — имя файла без папок');
    if (!bytes.length) throw new HttpError(400, 'Пустой файл');
    if (bytes.length > REPORT_MAX) throw new HttpError(413, `Файл больше ${REPORT_MAX / 1024 / 1024} МБ`);
    if (m.taskId != null && !FILE_ID_RE.test(m.taskId)) throw new HttpError(400, 'taskId — id задачи сайта');
    const files = (Array.isArray(m.files) ? m.files : []).slice(0, 200).map((f) => ({
      name: String(f?.name ?? '').slice(0, 200),
      size: Number.isInteger(f?.size) ? f.size : 0,
      mtime: Number.isInteger(f?.mtime) ? f.mtime : 0,
    }));
    const fsr = await firestore();
    const id = randomId();
    const url = `/files/${id}`;
    const chunks = Math.ceil(bytes.length / REPORT_CHUNK);
    const toFields = (data) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, fsr.toValue(v)]));
    const doc = {
      name: m.name,
      size: bytes.length,
      type: m.name.endsWith('.zip') ? 'application/zip' : m.name.endsWith('.gz') ? 'application/gzip' : 'text/plain',
      chunks,
      complete: false,
      createdAt: Date.now(),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      author: String(by).slice(0, 24),
      taskId: m.taskId ?? null,
      report: {
        kind: m.kind,
        type: m.type,
        label: String(m.label ?? '').slice(0, 80),
        note: String(m.note ?? '').slice(0, 500),
        files,
        source: 'tfc',
      },
    };
    await api(`${url}?currentDocument.exists=false`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: toFields(doc) }),
    });
    try {
      for (let i = 0; i < chunks; i++) {
        const data = bytes.subarray(i * REPORT_CHUNK, (i + 1) * REPORT_CHUNK);
        await api(`${url}/chunks/${i}`, {
          method: 'PATCH',
          body: JSON.stringify({
            fields: { i: { integerValue: String(i) }, data: { bytesValue: data.toString('base64') } },
          }),
        });
      }
      await api(`${url}?updateMask.fieldPaths=complete`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: { complete: { booleanValue: true } } }),
      });
    } catch (e) {
      for (let i = 0; i < chunks; i++) await api(`${url}/chunks/${i}`, { method: 'DELETE' }).catch(() => {});
      await api(url, { method: 'DELETE' }).catch(() => {});
      throw e;
    }
    return { id, name: doc.name, size: doc.size, chunks, kind: m.kind, type: m.type, author: doc.author };
  }

  return {
    addons,
    registerAddonVersion,
    publishSchematic,
    uploadReport,
    datapacks,
    kubejs,
    schematics,
    filePath,
    configChanges,
    setConfigChange,
    reset: () => cache.clear(),
  };
}
