import type { FileSource, TaskFile } from '@/features/task-files';
import { BASE, DevError, headers, type DevFile } from './api';

/**
 * Вложения задач разработки — на сервере сборки (dev #357), не в Firestore: список приходит вместе с задачей
 * (GET /dev/tasks/:id → files), содержимое — GET /dev/files/:id/content, загрузка — POST /dev/tasks/:id/files.
 * Содержимое по id не меняется — держим в памяти и сверяем размер и SHA256.
 */

/** Сервер принимает до 50 МБ (DEV_FILE_MAX_BYTES); проверка здесь — чтобы не гнать лишнее */
export const DEV_FILE_MAX = 50 * 1024 * 1024;

const sha256Hex = async (blob: Blob) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

async function fail(res: Response): Promise<never> {
  const body = await res.json().catch(() => ({}));
  throw new DevError(`Вложения: ${body.error ?? `${res.status} ${res.statusText}`}`, res.status);
}

/** Загрузка с прогрессом (XHR: у fetch нет прогресса отправки) */
export async function uploadDevFile(task: number, file: File, by: string, onProgress?: (f: number) => void) {
  const h = {
    ...(await headers()),
    'Content-Type': file.type || 'application/octet-stream',
    'X-File-Name': encodeURIComponent(file.name),
    'X-File-Sha256': await sha256Hex(file),
    'X-File-By': encodeURIComponent(by),
  };
  return new Promise<DevFile>((ok, ko) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/dev/tasks/${task}/files`);
    for (const [k, v] of Object.entries(h)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let body: { file?: DevFile; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* не JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.file) ok(body.file);
      else ko(new DevError(`Вложения: ${body.error ?? `${xhr.status} ${xhr.statusText}`}`, xhr.status));
    };
    xhr.onerror = () => ko(new DevError('Сервер сборки недоступен', 0));
    xhr.send(file);
  });
}

const blobs = new Map<string, Promise<Blob>>();
const urls = new Map<string, Promise<string>>();

export function readDevFile(f: TaskFile & { sha256?: string }): Promise<Blob> {
  let p = blobs.get(f.id);
  if (!p) {
    p = (async () => {
      const res = await fetch(`${BASE}/dev/files/${encodeURIComponent(f.id)}/content`, { headers: await headers() });
      if (!res.ok) await fail(res);
      const blob = new Blob([await res.arrayBuffer()], { type: f.type });
      if (blob.size !== f.size) throw new Error(`Файл «${f.name}» повреждён: ${blob.size} байт вместо ${f.size}`);
      if (f.sha256 && (await sha256Hex(blob)) !== f.sha256)
        throw new Error(`Файл «${f.name}» повреждён: не совпала контрольная сумма`);
      return blob;
    })();
    p.catch(() => blobs.delete(f.id));
    blobs.set(f.id, p);
    // Держим последние 60 файлов — скриншоты в сотни КБ, в памяти это немного
    if (blobs.size > 60) blobs.delete(blobs.keys().next().value!);
  }
  return p;
}

function url(f: TaskFile): Promise<string> {
  let p = urls.get(f.id);
  if (!p) {
    p = readDevFile(f).then((b) => URL.createObjectURL(b));
    p.catch(() => urls.delete(f.id));
    urls.set(f.id, p);
  }
  return p;
}

export async function downloadDevFile(f: TaskFile) {
  const u = URL.createObjectURL(await readDevFile(f));
  const a = document.createElement('a');
  a.href = u;
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 10_000);
}

async function remove(f: TaskFile, by: string) {
  const res = await fetch(`${BASE}/dev/files/${encodeURIComponent(f.id)}`, {
    method: 'DELETE',
    headers: { ...(await headers()), 'X-File-By': encodeURIComponent(by) },
  });
  if (!res.ok && res.status !== 404) await fail(res);
  urls.get(f.id)?.then(
    (u) => URL.revokeObjectURL(u),
    () => {},
  );
  urls.delete(f.id);
  blobs.delete(f.id);
}

/** Источник для галереи и списка вложений; onChanged — перечитать задачу после удаления */
export function devFileSource(files: DevFile[], by: string, onChanged: () => void): FileSource {
  return {
    enabled: true,
    files,
    maxSize: DEV_FILE_MAX,
    url,
    download: downloadDevFile,
    remove: (f) => remove(f, by).then(onChanged),
  };
}
