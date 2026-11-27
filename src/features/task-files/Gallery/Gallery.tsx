import { ChevronLeft, ChevronRight, Download, ImagePlus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatSize } from '@/entities/file';
import { dismissUpload, isImage, useUploads } from '@/lib/uploads';
import { cx, timeAgo } from '@/shared/lib';
import styles from './Gallery.module.css';
import { useStoreSource, type FileSource, type TaskFile } from '../source';

interface Props {
  taskId?: string;
  pending?: File[];
  onRemovePending?: (file: File) => void;
  onAdd: (files: File[]) => void;
  /** Своё хранилище; без него — общее хранилище файлов сайта */
  source?: FileSource;
}

/** Картинка сетки: загруженная (в базе) или из черновика новой задачи */
type Shot =
  | { key: string; kind: 'file'; file: TaskFile; name: string }
  | { key: string; kind: 'pending'; file: File; name: string; url: string };

/** Картинки задачи: превью-сетка под описанием + просмотр на весь экран */
export function Gallery(props: Props) {
  return props.source ? <GalleryView {...props} source={props.source} /> : <StoreGallery {...props} />;
}

function StoreGallery(props: Props) {
  return <GalleryView {...props} source={useStoreSource(props.taskId)} />;
}

function GalleryView({ taskId, pending, onRemovePending, onAdd, source }: Props & { source: FileSource }) {
  const files = source.files;
  const uploads = useUploads(taskId).filter((u) => u.image);
  const inputRef = useRef<HTMLInputElement>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const saved = useMemo(
    () => (taskId ? files.filter(isImage).sort((a, b) => a.createdAt - b.createdAt) : []),
    [files, taskId],
  );
  const pendingImages = useMemo(() => (pending ?? []).filter(isImage), [pending]);
  const pendingUrls = useMemo(() => pendingImages.map((f) => URL.createObjectURL(f)), [pendingImages]);
  useEffect(() => () => pendingUrls.forEach((u) => URL.revokeObjectURL(u)), [pendingUrls]);

  // Сетка и просмотр ходят по одному списку: картинка черновика открывается так же, как сохранённая
  const shots = useMemo<Shot[]>(
    () => [
      ...saved.map((f) => ({ key: f.id, kind: 'file' as const, file: f, name: f.name })),
      ...pendingImages.map((f, i) => ({
        key: 'pending-' + i,
        kind: 'pending' as const,
        file: f,
        name: f.name,
        url: pendingUrls[i],
      })),
    ],
    [saved, pendingImages, pendingUrls],
  );

  if (!source.enabled) return null;
  const hasAny = shots.length + uploads.length > 0;

  /** Убрать картинку из сетки — с подтверждением; из просмотра переходим к соседней */
  const remove = async (shot: Shot) => {
    if (!confirm('Удалить изображение «' + shot.name + '»?')) return;
    const i = shots.findIndex((s) => s.key === shot.key);
    const next = shots[i + 1] ?? shots[i - 1];
    if (shot.key === openKey) setOpenKey(next && next.key !== shot.key ? next.key : null);
    try {
      if (shot.kind === 'file') await source.remove(shot.file);
      else onRemovePending?.(shot.file);
    } catch (e) {
      alert('Не удалось удалить «' + shot.name + '»: ' + (e instanceof Error ? e.message : e));
    }
  };

  const open = openKey === null ? -1 : shots.findIndex((s) => s.key === openKey);

  return (
    <div
      className={cx(styles.gallery, dragging && styles.dragging)}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        if (e.dataTransfer.files.length) onAdd([...e.dataTransfer.files]);
      }}
    >
      {hasAny && (
        <div className={styles.galleryGrid}>
          {shots.map((shot) => (
            <Thumb
              key={shot.key}
              shot={shot}
              source={source}
              onOpen={() => setOpenKey(shot.key)}
              onRemove={() => remove(shot)}
            />
          ))}
          {uploads.map((u) => (
            <div
              key={u.key}
              className={cx(styles.gThumb, styles.uploading, u.error && styles.failed)}
              title={u.error ?? u.name}
            >
              {u.preview && <img src={u.preview} alt={u.name} />}
              {u.error ? (
                <button className={cx(styles.gOverlay, styles.err)} onClick={() => dismissUpload(u.key)}>
                  Ошибка · скрыть
                </button>
              ) : (
                <span className={styles.gOverlay}>{Math.round(u.progress * 100)}%</span>
              )}
            </div>
          ))}
        </div>
      )}
      <button type="button" className={styles.galleryAdd} onClick={() => inputRef.current?.click()}>
        <ImagePlus size={15} />
        {dragging ? 'Отпустите, чтобы добавить' : 'Добавить изображения'}
        <span className="faint small hide-sm">или Ctrl+V — вставить скриншот</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) onAdd([...e.target.files]);
          e.target.value = '';
        }}
      />
      {open >= 0 && (
        <Lightbox
          shots={shots}
          source={source}
          index={open}
          onIndex={(i) => setOpenKey(shots[i]?.key ?? null)}
          onRemove={(shot) => remove(shot)}
          onClose={() => setOpenKey(null)}
        />
      )}
    </div>
  );
}

/** object URL сохранённой картинки; у картинки черновика свой URL, поэтому для неё f нет и url = null */
function useImageUrl(source: FileSource, f?: TaskFile) {
  // Состояние помнит, для какого файла получен URL: при переходе к соседней картинке старый не показываем
  const [got, setGot] = useState<{ id: string; url?: string; failed?: boolean } | null>(null);
  useEffect(() => {
    if (!f) return;
    let alive = true;
    source.url(f).then(
      (u) => alive && setGot({ id: f.id, url: u }),
      () => alive && setGot({ id: f.id, failed: true }),
    );
    return () => {
      alive = false;
    };
  }, [f, source]);
  const own = f && got?.id === f.id ? got : null;
  return { url: own?.url ?? null, failed: Boolean(own?.failed) };
}

function Thumb({
  shot,
  source,
  onOpen,
  onRemove,
}: {
  shot: Shot;
  source: FileSource;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { url: savedUrl, failed } = useImageUrl(source, shot.kind === 'file' ? shot.file : undefined);
  const url = shot.kind === 'pending' ? shot.url : savedUrl;
  return (
    <div className={styles.gThumb} title={shot.name}>
      <button type="button" className={styles.gOpen} onClick={onOpen} aria-label={'Открыть ' + shot.name}>
        {url ? <img src={url} alt={shot.name} /> : <span className={cx(styles.gSkeleton, failed && styles.failed)} />}
      </button>
      <button
        type="button"
        className={styles.gRemove}
        onClick={onRemove}
        aria-label={'Удалить ' + shot.name}
        title="Удалить"
      >
        <X size={13} />
      </button>
    </div>
  );
}

function Lightbox({
  shots,
  source,
  index,
  onIndex,
  onRemove,
  onClose,
}: {
  shots: Shot[];
  source: FileSource;
  index: number;
  onIndex: (i: number) => void;
  onRemove: (shot: Shot) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  const shot = shots[index];
  const { url: savedUrl } = useImageUrl(source, shot?.kind === 'file' ? shot.file : undefined);
  const url = shot?.kind === 'pending' ? shot.url : savedUrl;
  const go = (d: number) => onIndex((index + d + shots.length) % shots.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else return;
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!shot) return null;

  const meta =
    shot.kind === 'file'
      ? formatSize(shot.file.size) + ' · ' + shot.file.author + ' · ' + timeAgo(shot.file.createdAt)
      : 'не загружено — появится после создания задачи';

  return createPortal(
    <dialog
      ref={dialogRef}
      className={styles.lightbox}
      onCancel={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      aria-label={shot.name}
    >
      <div className={styles.lbTop}>
        <span className={styles.lbTitle}>
          {shot.name}
          <span className={styles.lbMeta}>
            {meta}
            {shots.length > 1 && ' · ' + (index + 1) + ' из ' + shots.length}
          </span>
        </span>
        {shot.kind === 'file' ? (
          <button
            className={styles.lbBtn}
            onClick={() => source.download(shot.file)}
            aria-label="Скачать"
            title="Скачать"
          >
            <Download size={18} />
          </button>
        ) : (
          <a className={styles.lbBtn} href={shot.url} download={shot.name} aria-label="Скачать" title="Скачать">
            <Download size={18} />
          </a>
        )}
        <button className={styles.lbBtn} onClick={() => onRemove(shot)} aria-label="Удалить" title="Удалить">
          <Trash2 size={18} />
        </button>
        <button className={styles.lbBtn} onClick={onClose} aria-label="Закрыть" title="Закрыть (Esc)">
          <X size={20} />
        </button>
      </div>
      {url ? (
        <img className={styles.lbImg} src={url} alt={shot.name} onMouseDown={(e) => e.stopPropagation()} />
      ) : (
        <div className={styles.lbLoading}>Загрузка…</div>
      )}
      {shots.length > 1 && (
        <>
          <button className={cx(styles.lbNav, styles.prev)} onClick={() => go(-1)} aria-label="Предыдущее">
            <ChevronLeft size={28} />
          </button>
          <button className={cx(styles.lbNav, styles.next)} onClick={() => go(1)} aria-label="Следующее">
            <ChevronRight size={28} />
          </button>
        </>
      )}
    </dialog>,
    document.body,
  );
}
