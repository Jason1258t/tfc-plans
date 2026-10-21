/**
 * Контент сайта для `tfc pull`: датапаки «Ставить в мир», скрипты KubeJS «Ставить на сервер», схемы библиотеки
 * и исходники схем. Сайт закрыт App Check, поэтому программа берёт всё здесь, а сервер читает Firestore REST
 * сервисным ключом (GOOGLE_APPLICATION_CREDENTIALS; без него — от имени `firebase login`, это для разработки).
 *
 * Доступ к Firestore — scripts/firestore-rest.mjs из копии репозитория (той же, что собирает данные): сервер
 * в /opt/tfc-pack без scripts/. Бюджет бесплатного тарифа — 50 тыс. чтений в сутки на всех, поэтому списки
 * кешируются на SITE_CACHE_SEC (по умолчанию 5 минут), а файлы схем — на диске навсегда (файл с данным id
 * не меняется: правка схемы на сайте — новый файл).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HttpError } from './util.mjs';

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
];
const FILE_ID_RE = /^[A-Za-z0-9]{1,64}$/;

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
    rest = {
      docs: docsUrl || m.DOCS,
      fromValue: m.fromValue,
      toValue: m.toValue,
      async auth() {
        if (!tok || tok.until < Date.now()) tok = { value: await m.token(), until: Date.now() + 45 * 60_000 };
        return tok.value;
      },
    };
    return rest;
  }

  async function api(url, init = {}) {
    const fsr = await firestore();
    let res;
    try {
      res = await fetch(fsr.docs + url, {
        ...init,
        headers: { Authorization: `Bearer ${await fsr.auth()}`, 'Content-Type': 'application/json' },
      });
    } catch (e) {
      throw new HttpError(502, `Firestore недоступен: ${e.cause?.code ?? e.message}`);
    }
    if (res.status === 404) return null;
    // Условие записи не выполнено (документ изменили после чтения)
    if (res.status === 400 && init.method === 'PATCH' && /FAILED_PRECONDITION/.test(await res.clone().text()))
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
      for (const d of r?.documents ?? []) out.push({ id: d.name.split('/').pop(), ...fields(fsr, d) });
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

  return {
    datapacks,
    kubejs,
    schematics,
    filePath,
    configChanges,
    setConfigChange,
    reset: () => cache.clear(),
  };
}
