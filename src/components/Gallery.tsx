import { ChevronLeft, ChevronRight, Download, ImagePlus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useData } from '../data/DataContext';
import { downloadFile, fileUrl, filesEnabled, formatSize, removeFile, type FileMeta } from '../lib/files';
import { dismissUpload, isImage, useUploads } from '../lib/uploads';
import { cx, timeAgo } from '../lib/util';
import './Gallery.css';

interface Props {
  taskId?: string;
  pending?: File[];
  onRemovePending?: (file: File) => void;
  onAdd: (files: File[]) => void;
}

/** Картинки задачи: превью-сетка под описанием + просмотр на весь экран */
export function Gallery({ taskId, pending, onRemovePending, onAdd }: Props) {
  const { files } = useData();
  const uploads = useUploads(taskId).filter((u) => u.image);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const images = taskId
    ? files.filter((f) => f.taskId === taskId && isImage(f)).sort((a, b) => a.createdAt - b.createdAt)
    : [];
  const pendingImages = useMemo(() => (pending ?? []).filter(isImage), [pending]);
  const pendingUrls = useMemo(() => pendingImages.map((f) => URL.createObjectURL(f)), [pendingImages]);
  useEffect(() => () => pendingUrls.forEach((u) => URL.revokeObjectURL(u)), [pendingUrls]);

  if (!filesEnabled) return null;
  const hasAny = images.length + pendingImages.length + uploads.length > 0;

  return (
    <div
      className={cx('gallery', dragging && 'dragging')}
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
        <div className="gallery-grid">
          {images.map((f, i) => (
            <Thumb key={f.id} file={f} onOpen={() => setOpen(i)} />
          ))}
          {pendingImages.map((f, i) => (
            <div key={`p-${i}`} className="g-thumb">
              <img src={pendingUrls[i]} alt={f.name} />
              <button
                className="g-remove"
                onClick={() => onRemovePending?.(f)}
                aria-label={`Убрать ${f.name}`}
                title="Убрать"
              >
                <X size={13} />
              </button>
            </div>
          ))}
          {uploads.map((u) => (
            <div key={u.key} className={cx('g-thumb uploading', u.error && 'failed')} title={u.error ?? u.name}>
              {u.preview && <img src={u.preview} alt={u.name} />}
              {u.error ? (
                <button className="g-overlay err" onClick={() => dismissUpload(u.key)}>
                  Ошибка · скрыть
                </button>
              ) : (
                <span className="g-overlay">{Math.round(u.progress * 100)}%</span>
              )}
            </div>
          ))}
        </div>
      )}
      <button type="button" className="gallery-add" onClick={() => inputRef.current?.click()}>
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
      {open !== null && images[open] && (
        <Lightbox images={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function useImageUrl(f: FileMeta) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fileUrl(f).then(
      (u) => alive && setUrl(u),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [f]);
  return { url, failed };
}

function Thumb({ file, onOpen }: { file: FileMeta; onOpen: () => void }) {
  const { url, failed } = useImageUrl(file);
  return (
    <button className="g-thumb" onClick={onOpen} title={file.name} aria-label={`Открыть ${file.name}`}>
      {url ? <img src={url} alt={file.name} /> : <span className={cx('g-skeleton', failed && 'failed')} />}
    </button>
  );
}

function Lightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: FileMeta[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const f = images[index];
  const { url } = useImageUrl(f);
  const go = (d: number) => onIndex((index + d + images.length) % images.length);

  useEffect(() => {
    // capture на window срабатывает раньше обработчика модалки — Esc закрывает только просмотр
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else return;
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const remove = async () => {
    if (!confirm(`Удалить изображение «${f.name}»?`)) return;
    if (images.length === 1) onClose();
    else if (index === images.length - 1) onIndex(index - 1);
    await removeFile(f);
  };

  return createPortal(
    <div
      className="lightbox"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-label={f.name}
    >
      <div className="lb-top">
        <span className="lb-title">
          {f.name}
          <span className="lb-meta">
            {formatSize(f.size)} · {f.author} · {timeAgo(f.createdAt)}
            {images.length > 1 && ` · ${index + 1} из ${images.length}`}
          </span>
        </span>
        <button className="lb-btn" onClick={() => downloadFile(f)} aria-label="Скачать" title="Скачать">
          <Download size={18} />
        </button>
        <button className="lb-btn" onClick={remove} aria-label="Удалить" title="Удалить">
          <Trash2 size={18} />
        </button>
        <button className="lb-btn" onClick={onClose} aria-label="Закрыть" title="Закрыть (Esc)">
          <X size={20} />
        </button>
      </div>
      {url ? (
        <img className="lb-img" src={url} alt={f.name} onMouseDown={(e) => e.stopPropagation()} />
      ) : (
        <div className="lb-loading">Загрузка…</div>
      )}
      {images.length > 1 && (
        <>
          <button className="lb-nav prev" onClick={() => go(-1)} aria-label="Предыдущее">
            <ChevronLeft size={28} />
          </button>
          <button className="lb-nav next" onClick={() => go(1)} aria-label="Следующее">
            <ChevronRight size={28} />
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}
