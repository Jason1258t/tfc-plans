import type { FileAdapter, StoredFile, UploadOptions } from './types';

/**
 * Реализация на своём сервере файлов (server/file-server). API:
 *   GET  /files/events        — SSE: snapshot (весь список), put (файл добавлен), delete ({id})
 *   GET  /files/:id           — запись; GET /files/:id/content — содержимое
 *   POST /files               — загрузка: тело — файл, X-File-Name / X-File-Meta (encodeURIComponent) / X-File-Sha256
 *   DELETE /files/:id
 * Каждый запрос несёт заголовки из headers() — ID-токен Firebase (анонимный вход) и токен App Check.
 */
export interface ServerAdapterOptions {
  /** https://files.example.com — без / на конце */
  baseUrl: string;
  maxFileSize: number;
  ready?: () => Promise<unknown>;
  headers?: () => Promise<Record<string, string>>;
  /** сколько байт содержимого держать в памяти; по умолчанию 64 МиБ */
  cacheBytes?: number;
}

const sha256Hex = async (blob: Blob) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function serverAdapter<M extends object>(opts: ServerAdapterOptions): FileAdapter<M> {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const cacheLimit = opts.cacheBytes ?? 64 * 1024 * 1024;
  const blobs = new Map<string, { p: Promise<Blob>; size: number }>();
  const urls = new Map<string, Promise<string>>();
  const known = new Map<string, StoredFile<M>>();

  const headers = async (extra?: Record<string, string>) => {
    await opts.ready?.();
    return { ...(await opts.headers?.()), ...extra };
  };

  async function fail(res: Response): Promise<never> {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* тело не JSON */
    }
    throw new Error(`Сервер файлов: ${msg}`);
  }

  async function get(id: string): Promise<StoredFile<M> | null> {
    const res = await fetch(`${base}/files/${encodeURIComponent(id)}`, { headers: await headers() });
    if (res.status === 404) return null;
    if (!res.ok) await fail(res);
    return res.json();
  }

  async function resolve(file: StoredFile<M> | string): Promise<StoredFile<M>> {
    if (typeof file !== 'string') return file;
    const f = known.get(file) ?? (await get(file));
    if (!f) throw new Error(`Файл ${file} не найден`);
    return f;
  }

  function cacheSet(id: string, p: Promise<Blob>, size: number) {
    blobs.delete(id);
    blobs.set(id, { p, size });
    let total = 0;
    for (const v of blobs.values()) total += v.size;
    // Вытесняем самые старые (Map хранит порядок вставки), кроме только что добавленного
    for (const [k, v] of blobs) {
      if (total <= cacheLimit || k === id) break;
      blobs.delete(k);
      total -= v.size;
    }
  }

  function upload(data: Blob, { meta, name, type, onProgress, signal }: UploadOptions<M>): Promise<StoredFile<M>> {
    if (data.size > opts.maxFileSize) return Promise.reject(new Error('Файл больше допустимого размера'));
    return (async () => {
      const fileName = name ?? (data instanceof File ? data.name : 'file');
      const h = await headers({
        'Content-Type': type || data.type || 'application/octet-stream',
        'X-File-Name': encodeURIComponent(fileName),
        'X-File-Meta': encodeURIComponent(JSON.stringify(meta)),
        'X-File-Sha256': await sha256Hex(data),
      });
      // XHR, а не fetch: у fetch нет прогресса отправки
      const stored = await new Promise<StoredFile<M>>((ok, ko) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${base}/files`);
        for (const [k, v] of Object.entries(h)) xhr.setRequestHeader(k, v);
        xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
        xhr.onload = () => {
          let body: { error?: string } | null = null;
          try {
            body = JSON.parse(xhr.responseText);
          } catch {
            /* не JSON */
          }
          if (xhr.status >= 200 && xhr.status < 300 && body) ok(body as StoredFile<M>);
          else ko(new Error(`Сервер файлов: ${body?.error ?? `${xhr.status} ${xhr.statusText}`}`));
        };
        xhr.onerror = () => ko(new Error('Сервер файлов недоступен'));
        xhr.onabort = () => ko(new Error('Загрузка отменена'));
        signal?.addEventListener('abort', () => xhr.abort(), { once: true });
        xhr.send(data);
      });
      known.set(stored.id, stored);
      cacheSet(stored.id, Promise.resolve(data), data.size);
      return stored;
    })();
  }

  function subscribe(onNext: (files: StoredFile<M>[]) => void, onError?: (e: Error) => void) {
    let stopped = false;
    let ctrl: AbortController | null = null;
    const emit = () => onNext([...known.values()]);

    const handle = (block: string) => {
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) return; // «: ping» и пустые блоки
      const payload = JSON.parse(data);
      if (event === 'snapshot') {
        known.clear();
        for (const f of payload as StoredFile<M>[]) known.set(f.id, f);
      } else if (event === 'put') known.set(payload.id, payload);
      else if (event === 'delete') known.delete(payload.id);
      else return;
      emit();
    };

    (async () => {
      let delay = 1000;
      let reported = false;
      while (!stopped) {
        try {
          ctrl = new AbortController();
          const res = await fetch(`${base}/files/events`, { headers: await headers(), signal: ctrl.signal });
          if (!res.ok || !res.body) await fail(res);
          delay = 1000;
          reported = false;
          const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
          let buf = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += value.replace(/\r/g, '');
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              handle(buf.slice(0, i));
              buf = buf.slice(i + 2);
            }
          }
        } catch (e) {
          if (stopped) return;
          // Об обрыве сообщаем один раз — дальше тихо переподключаемся
          if (!reported) onError?.(e instanceof Error ? e : new Error(String(e)));
          reported = true;
        }
        if (stopped) return;
        await sleep(delay);
        delay = Math.min(delay * 2, 30_000);
      }
    })();

    return () => {
      stopped = true;
      ctrl?.abort();
    };
  }

  function read(file: StoredFile<M> | string): Promise<Blob> {
    const id = typeof file === 'string' ? file : file.id;
    const hit = blobs.get(id);
    if (hit) return hit.p;
    const p = (async () => {
      const f = await resolve(file);
      const res = await fetch(`${base}/files/${encodeURIComponent(id)}/content`, { headers: await headers() });
      if (!res.ok) await fail(res);
      const blob = new Blob([await res.arrayBuffer()], { type: f.type });
      if (blob.size !== f.size) throw new Error(`Файл «${f.name}» повреждён: ${blob.size} байт вместо ${f.size}`);
      if (f.sha256 && (await sha256Hex(blob)) !== f.sha256)
        throw new Error(`Файл «${f.name}» повреждён: не совпала контрольная сумма`);
      return blob;
    })();
    cacheSet(id, p, 0);
    p.then(
      (b) => blobs.get(id)?.p === p && cacheSet(id, p, b.size),
      () => blobs.get(id)?.p === p && blobs.delete(id),
    );
    return p;
  }

  function objectUrl(file: StoredFile<M> | string): Promise<string> {
    const id = typeof file === 'string' ? file : file.id;
    let p = urls.get(id);
    if (!p) {
      p = read(file).then((b) => URL.createObjectURL(b));
      p.catch(() => urls.delete(id));
      urls.set(id, p);
    }
    return p;
  }

  function release(id: string) {
    urls.get(id)?.then(
      (u) => URL.revokeObjectURL(u),
      () => {},
    );
    urls.delete(id);
    blobs.delete(id);
  }

  async function download(file: StoredFile<M> | string) {
    const f = await resolve(file);
    const url = URL.createObjectURL(await read(f));
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function remove(file: StoredFile<M> | string) {
    const id = typeof file === 'string' ? file : file.id;
    const res = await fetch(`${base}/files/${encodeURIComponent(id)}`, { method: 'DELETE', headers: await headers() });
    if (!res.ok && res.status !== 404) await fail(res);
    known.delete(id);
    release(id);
  }

  return {
    kind: 'server',
    maxFileSize: opts.maxFileSize,
    upload,
    get,
    subscribe,
    read,
    objectUrl,
    release,
    download,
    remove,
  };
}
