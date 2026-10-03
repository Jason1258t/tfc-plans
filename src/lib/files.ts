import {
  Bytes,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { authReady, db } from '../firebase';

/**
 * Вложения задач. Firebase Storage на бесплатном тарифе недоступен, поэтому файл хранится
 * в Firestore: метаданные в files/{id}, содержимое — кусками в files/{id}/chunks/{n}.
 * Файл показывается только после записи всех кусков (complete: true).
 */
export interface FileMeta {
  id: string;
  name: string;
  size: number;
  type: string;
  taskId: string | null;
  author: string;
  chunks: number;
  complete: boolean;
  createdAt: number;
}

export const filesEnabled = Boolean(db);
export const MAX_FILE_SIZE = 25 * 1024 * 1024;
/** Документ Firestore — максимум 1 MiB, оставляем запас на служебные поля */
const CHUNK_SIZE = 700 * 1024;

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export function subscribeFiles(cb: (files: FileMeta[]) => void, onError?: (e: Error) => void): () => void {
  if (!db) {
    queueMicrotask(() => cb([]));
    return () => {};
  }
  let unsub = () => {};
  let cancelled = false;
  authReady.then(() => {
    if (cancelled) return;
    unsub = onSnapshot(
      query(collection(db!, 'files'), where('complete', '==', true)),
      (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as Omit<FileMeta, 'id'>), id: d.id }))),
      (e) => onError?.(e),
    );
  });
  return () => {
    cancelled = true;
    unsub();
  };
}

export async function uploadFile(
  file: File,
  opts: { taskId: string | null; author: string },
  onProgress?: (fraction: number) => void,
): Promise<string> {
  if (!db) throw new Error('Вложения доступны только с подключённым Firebase');
  if (file.size > MAX_FILE_SIZE) throw new Error(`Файл больше ${formatSize(MAX_FILE_SIZE)}`);
  await authReady;

  const meta = doc(collection(db, 'files'));
  const chunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  await setDoc(meta, {
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
    taskId: opts.taskId,
    author: opts.author,
    chunks,
    complete: false,
    createdAt: Date.now(),
  });

  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    for (let i = 0; i < chunks; i++) {
      const part = buf.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      await setDoc(doc(meta, 'chunks', String(i)), { i, data: Bytes.fromUint8Array(part) });
      onProgress?.((i + 1) / chunks);
    }
    await updateDoc(meta, { complete: true });
  } catch (e) {
    // Недокачанный файл не оставляем
    await removeFile({ id: meta.id, chunks }).catch(() => {});
    throw e;
  }
  return meta.id;
}

const blobCache = new Map<string, Promise<Blob>>();

/** Собирает файл из кусков (результат кешируется на время сессии) */
export function fileBlob(f: FileMeta): Promise<Blob> {
  let p = blobCache.get(f.id);
  if (!p) {
    p = (async () => {
      await authReady;
      const snap = await getDocs(collection(db!, 'files', f.id, 'chunks'));
      const parts = snap.docs
        .map((d) => d.data() as { i: number; data: Bytes })
        .sort((a, b) => a.i - b.i)
        .map((c) => c.data.toUint8Array());
      if (parts.length !== f.chunks) throw new Error('Файл повреждён: не хватает частей');
      return new Blob(parts as BlobPart[], { type: f.type });
    })();
    p.catch(() => blobCache.delete(f.id));
    blobCache.set(f.id, p);
  }
  return p;
}

const urlCache = new Map<string, Promise<string>>();
/** object URL для показа картинки в <img> */
export function fileUrl(f: FileMeta): Promise<string> {
  let p = urlCache.get(f.id);
  if (!p) {
    p = fileBlob(f).then((b) => URL.createObjectURL(b));
    p.catch(() => urlCache.delete(f.id));
    urlCache.set(f.id, p);
  }
  return p;
}

export async function downloadFile(f: FileMeta): Promise<void> {
  const url = URL.createObjectURL(await fileBlob(f));
  const a = document.createElement('a');
  a.href = url;
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function removeFile(f: Pick<FileMeta, 'id' | 'chunks'>): Promise<void> {
  await authReady;
  const batch = writeBatch(db!);
  for (let i = 0; i < f.chunks; i++) batch.delete(doc(db!, 'files', f.id, 'chunks', String(i)));
  await batch.commit();
  await deleteDoc(doc(db!, 'files', f.id));
}
