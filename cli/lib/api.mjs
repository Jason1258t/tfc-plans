/**
 * Сервер сборки: запросы с ключом, скачивание и заливка файлов потоком (jar — сотни МБ).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import { sha256File } from './scan.mjs';

export class Api {
  constructor(server, token) {
    this.server = server.replace(/\/+$/, '');
    this.token = token;
  }

  headers(extra = {}) {
    return { ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...extra };
  }

  async req(method, url, body) {
    let res;
    try {
      res = await fetch(this.server + url, {
        method,
        headers: this.headers(body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new Error(`сервер сборки ${this.server} недоступен: ${e.cause?.code ?? e.message}`);
    }
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text.slice(0, 200) };
    }
    if (!res.ok) {
      const err = new Error(apiError(res.status, data));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  get = (url) => this.req('GET', url);
  post = (url, body) => this.req('POST', url, body);
  del = (url) => this.req('DELETE', url);

  /** Небольшой файл целиком (исходник схемы с сайта) */
  async bytes(url) {
    let res;
    try {
      res = await fetch(this.server + url, { headers: this.headers() });
    } catch (e) {
      throw new Error(`сервер сборки ${this.server} недоступен: ${e.cause?.code ?? e.message}`);
    }
    if (!res.ok) throw new Error(apiError(res.status, await res.json().catch(() => null)));
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Текущий снимок или null, если сборку ещё не заливали */
  async current() {
    try {
      return await this.get('/pack/current');
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  /** Роль ключа: admin видит список ключей, player получает 403 */
  async role() {
    await this.get('/pack/snapshots');
    try {
      await this.get('/admin/keys');
      return 'admin';
    } catch (e) {
      if (e.status === 403) return 'player';
      throw e;
    }
  }

  /**
   * Скачать файл в target; оборванную загрузку (target.part) докачивает с места обрыва. Хеш считается по дороге
   * (готовый кусок .part — перед ним), файл не перечитывается.
   */
  async download(sha256, target, onBytes) {
    const part = `${target}.part`;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    const res = await fetch(`${this.server}/blobs/${sha256}`, {
      headers: this.headers(have ? { Range: `bytes=${have}-` } : {}),
    });
    let got;
    if (res.status === 416)
      got = await sha256File(part); // .part уже полный или испорчен — проверим хеш
    else if (!res.ok) throw new Error(apiError(res.status, await res.json().catch(() => null)));
    else {
      if (res.status !== 206) have = 0;
      const h = createHash('sha256');
      if (have) for await (const d of fs.createReadStream(part)) h.update(d);
      const body = Readable.fromWeb(res.body);
      body.on('data', (d) => {
        h.update(d);
        onBytes?.(d.length);
      });
      await pipeline(body, fs.createWriteStream(part, { flags: have ? 'a' : 'w' }));
      got = h.digest('hex');
    }
    if (got !== sha256) {
      fs.rmSync(part, { force: true });
      throw new Error(`файл ${path.basename(target)} пришёл повреждённым (хеш не сошёлся) — запустите ещё раз`);
    }
    fs.renameSync(part, target);
  }

  /**
   * Мелкие файлы одним запросом (POST /blobs/pack): каждый ложится в dir/<sha256> после сверки хеша.
   * Сервер без пакетов (старый) — null, тогда качаем по одному.
   */
  async pack(shas, dir, onBytes) {
    let res;
    try {
      res = await fetch(`${this.server}/blobs/pack`, {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ sha256: shas }),
      });
    } catch (e) {
      throw new Error(`сервер сборки ${this.server} недоступен: ${e.cause?.code ?? e.message}`);
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      // Сервер старый: /blobs/pack он принимает за файл с неверным sha256 (400) или не знает адреса
      const err = data?.error ?? '';
      if ((res.status === 400 && /^sha256 — 64/.test(err)) || (res.status === 404 && !/^Нет файла/.test(err)))
        return null;
      throw new Error(apiError(res.status, data));
    }
    fs.mkdirSync(dir, { recursive: true });
    const HEAD = 76; // sha256 (64) + размер (12)
    let buf = Buffer.alloc(0);
    let cur = null; // { sha, left, hash, chunks }
    const done = new Set();
    const finish = () => {
      if (cur.hash.digest('hex') !== cur.sha)
        throw new Error('пакет файлов пришёл повреждённым (хеш не сошёлся) — запустите ещё раз');
      const tmp = path.join(dir, `${cur.sha}.part`);
      fs.writeFileSync(tmp, Buffer.concat(cur.chunks));
      fs.renameSync(tmp, path.join(dir, cur.sha));
      done.add(cur.sha);
      cur = null;
    };
    const gunzip = Readable.fromWeb(res.body).pipe(zlib.createGunzip());
    for await (const chunk of gunzip) {
      onBytes?.(chunk.length);
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      for (;;) {
        if (!cur) {
          if (buf.length < HEAD) break;
          const head = buf.subarray(0, HEAD).toString('latin1');
          if (!/^[0-9a-f]{64}\d{12}$/.test(head)) throw new Error('пакет файлов пришёл в непонятном виде');
          cur = { sha: head.slice(0, 64), left: Number(head.slice(64)), hash: createHash('sha256'), chunks: [] };
          buf = buf.subarray(HEAD);
        }
        const take = buf.subarray(0, cur.left);
        cur.hash.update(take);
        cur.chunks.push(take);
        cur.left -= take.length;
        buf = buf.subarray(take.length);
        if (cur.left) break;
        finish();
      }
    }
    if (cur || buf.length) throw new Error('пакет файлов оборвался — запустите ещё раз');
    const lost = shas.filter((s) => !done.has(s));
    if (lost.length) throw new Error(`в пакете не хватило ${lost.length} файлов — запустите ещё раз`);
    return done.size;
  }

  /** Залить файл в хранилище сервера */
  async upload(file, sha256, onBytes) {
    const size = fs.statSync(file).size;
    const stream = fs.createReadStream(file);
    if (onBytes) stream.on('data', (d) => onBytes(d.length));
    const res = await fetch(`${this.server}/blobs/${sha256}`, {
      method: 'PUT',
      headers: this.headers({ 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) }),
      body: Readable.toWeb(stream),
      duplex: 'half',
    });
    if (!res.ok) throw new Error(`${path.basename(file)}: ${apiError(res.status, await res.json().catch(() => null))}`);
  }
}

function apiError(status, data) {
  const msg = data?.error ?? '';
  if (status === 401) return 'ключ не подошёл — tfc login <ключ>';
  if (status === 403) return msg || 'нужен ключ администратора сборки';
  return `сервер ответил ${status}${msg ? `: ${msg}` : ''}`;
}
