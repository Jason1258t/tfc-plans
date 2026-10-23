import { useEffect, useRef, useState } from 'react';
import { useData } from '../data/DataContext';
import {
  FILE_SCHEME,
  fileRefs,
  removeOrphanImages,
  UPLOADING_SCHEME,
  uploadImages,
  type ImageOwner,
} from '../lib/planImages';

/** Картинку без ссылок моложе этого при открытии текста не трогаем — её могли только что вставить в другом окне */
const ORPHAN_MIN_AGE = 10 * 60 * 1000;

interface Options {
  /** Владелец картинок; null — текст ещё не сохранён (черновик задачи): вставка картинок недоступна */
  owner: ImageOwner | null;
  /** Задача, во вложениях которой видны картинки */
  taskId: string | null;
  /** Текст на момент открытия */
  initial: string;
  /** Текущий текст и его замена (с автосохранением у вызывающего) */
  content: string;
  setContent: (next: string) => void;
  /** Вставить текст в позицию (и поставить туда курсор) */
  insert: (text: string, pos: number) => void;
}

/**
 * Картинки в тексте плана или описания задачи: загрузка со вставкой ссылки и уборка из хранилища тех,
 * что убрали из текста. Уборка — при закрытии (не на каждом сохранении — иначе Ctrl+Z вернул бы ссылку
 * на стёртый файл) и только того, что видел этот редактор: свежую картинку из чужого открытого редактора,
 * ссылка на которую ещё не сохранена, не трогаем. При открытии подчищается то, что не убралось раньше.
 */
export function useTextImages({ owner, taskId, initial, content, setContent, insert }: Options) {
  const { nick, files, artifacts, tasks } = useData();
  const [uploading, setUploading] = useState(0);

  const seen = useRef(fileRefs(initial));
  const latest = useRef({ content, files, artifacts, tasks, uploading });
  useEffect(() => {
    latest.current = { content, files, artifacts, tasks, uploading };
  }, [content, files, artifacts, tasks, uploading]);

  /** Коллбек редактора: какие картинки сейчас в тексте */
  const noteMedia = (srcs: string[]) => {
    for (const src of srcs) if (src.startsWith(FILE_SCHEME)) seen.current.add(src.slice(FILE_SCHEME.length));
  };

  // Владелец приходит новым объектом каждый рендер — эффекты следят за ключом, сам объект берут из ref
  const ownerKey = owner ? `${owner.kind}:${owner.id}` : '';
  const ownerRef = useRef(owner);
  useEffect(() => {
    ownerRef.current = owner;
  });
  useEffect(() => {
    const owner = ownerRef.current;
    if (!owner) return;
    const cleanup = () => {
      if (latest.current.uploading) return;
      removeOrphanImages(owner, latest.current.content, latest.current, { only: seen.current });
    };
    window.addEventListener('pagehide', cleanup);
    return () => {
      window.removeEventListener('pagehide', cleanup);
      cleanup();
    };
  }, [ownerKey]);

  const swept = useRef(false);
  const initialRef = useRef(initial);
  useEffect(() => {
    const owner = ownerRef.current;
    if (!owner || swept.current || !files.length) return;
    swept.current = true;
    removeOrphanImages(owner, initialRef.current, { files, artifacts, tasks }, { minAge: ORPHAN_MIN_AGE });
  }, [ownerKey, files, artifacts, tasks]);

  /** Сразу метка «загрузка» в тексте, после загрузки — ссылка на файл (сжатие — как у вложений задач) */
  const add = async (images: File[], pos: number) => {
    if (!owner || !images.length) return;
    const placeholder = `![Загрузка…](${UPLOADING_SCHEME}${Date.now()})`;
    const text = latest.current.content;
    // Картинка — отдельной строкой: не склеиваться с соседним текстом (заголовок перед ней перестал бы быть заголовком)
    const before = pos > 0 && text[pos - 1] !== '\n' ? '\n' : '';
    const after = text[pos] !== undefined && text[pos] !== '\n' ? '\n' : '';
    insert(`${before}${placeholder}\n${after}`, pos);
    setUploading((n) => n + 1);
    let markdown = '';
    try {
      const res = await uploadImages(images, { taskId, author: nick, owner });
      for (const id of res.ids) seen.current.add(id);
      markdown = res.markdown;
      if (res.error) alert(res.error);
    } catch (e) {
      alert(`Картинка не загрузилась: ${e instanceof Error ? e.message : e}`);
    } finally {
      setUploading((n) => n - 1);
      // Пока грузилось, текст могли править — меняем именно метку
      const cur = latest.current.content;
      if (cur.includes(placeholder)) setContent(cur.replace(placeholder, markdown));
    }
  };

  return { uploading, add, noteMedia, enabled: Boolean(owner) };
}
