import { Download, File as FileIcon, FileArchive, Paperclip, Trash2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useData } from '../data/DataContext';
import { downloadFile, filesEnabled, formatSize, MAX_FILE_SIZE, removeFile, type FileMeta } from '../lib/files';
import { dismissUpload, isImage, useUploads } from '../lib/uploads';
import { cx, timeAgo } from '../lib/util';
import './Attachments.css';

interface Props {
  /** Существующая задача; без него — черновик новой задачи */
  taskId?: string;
  /** Файлы черновика, загрузятся после «Создать» */
  pending?: File[];
  onRemovePending?: (file: File) => void;
  /** Добавить файлы (картинки уйдут в галерею, остальное — сюда) */
  onAdd: (files: File[]) => void;
  error?: string | null;
}

const isArchive = (name: string) => /\.(zip|jar|rar|7z|gz|tar)$/i.test(name);

/** Список вложений, кроме картинок — те показываются галереей */
export function Attachments({ taskId, pending, onRemovePending, onAdd, error }: Props) {
  const { files } = useData();
  const uploads = useUploads(taskId).filter((u) => !u.image);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [ownError, setOwnError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const attached = taskId
    ? files.filter((f) => f.taskId === taskId && !isImage(f)).sort((a, b) => a.createdAt - b.createdAt)
    : [];
  const pendingFiles = (pending ?? []).filter((f) => !isImage(f));

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    setOwnError(null);
    try {
      await fn();
    } catch (e) {
      setOwnError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const remove = (f: FileMeta) => confirm(`Удалить файл «${f.name}»?`) && run(f.id, () => removeFile(f));

  if (!filesEnabled) return <div className="faint small">Вложения доступны, когда подключён Firebase.</div>;

  const empty = !attached.length && !uploads.length && !pendingFiles.length;
  const shownError = error ?? ownError;

  return (
    <div
      className={cx('attach', dragging && 'dragging')}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) onAdd([...e.dataTransfer.files]);
      }}
    >
      {!empty && (
        <ul className="attach-list">
          {attached.map((f) => (
            <li key={f.id} className="attach-row">
              {isArchive(f.name) ? (
                <FileArchive size={18} className="attach-ico" />
              ) : (
                <FileIcon size={18} className="attach-ico" />
              )}
              <button className="attach-name" onClick={() => run(f.id, () => downloadFile(f))} title="Скачать">
                {f.name}
              </button>
              <span className="faint small attach-meta">
                {formatSize(f.size)} · {f.author} · {timeAgo(f.createdAt)}
              </span>
              <button
                className="btn ghost sm icon"
                onClick={() => run(f.id, () => downloadFile(f))}
                disabled={busyId === f.id}
                aria-label={`Скачать ${f.name}`}
                title="Скачать"
              >
                <Download size={15} />
              </button>
              <button
                className="btn ghost sm icon danger"
                onClick={() => remove(f)}
                disabled={busyId === f.id}
                aria-label={`Удалить ${f.name}`}
                title="Удалить"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
          {pendingFiles.map((f, i) => (
            <li key={`${f.name}-${i}`} className="attach-row">
              <FileIcon size={18} className="attach-ico" />
              <span className="attach-name static">{f.name}</span>
              <span className="faint small attach-meta">{formatSize(f.size)} · загрузится при создании</span>
              <button
                className="btn ghost sm icon"
                onClick={() => onRemovePending?.(f)}
                aria-label={`Убрать ${f.name}`}
              >
                <X size={15} />
              </button>
            </li>
          ))}
          {uploads.map((u) => (
            <li key={u.key} className="attach-row uploading">
              <FileIcon size={18} className="attach-ico" />
              <span className="attach-name static">{u.name}</span>
              {u.error ? (
                <>
                  <span className="small attach-meta" style={{ color: 'var(--danger)' }}>
                    {u.error}
                  </span>
                  <button className="btn ghost sm icon" onClick={() => dismissUpload(u.key)} aria-label="Скрыть">
                    <X size={15} />
                  </button>
                </>
              ) : (
                <span className="attach-meta attach-progress">
                  <span className="progress">
                    <span style={{ width: `${Math.max(4, u.progress * 100)}%` }} />
                  </span>
                  <span className="faint small">{Math.round(u.progress * 100)}%</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="attach-drop" onClick={() => inputRef.current?.click()}>
        <Paperclip size={15} />
        {dragging ? 'Отпустите, чтобы прикрепить' : 'Прикрепить файл или перетащить сюда'}
        <span className="faint small">до {formatSize(MAX_FILE_SIZE)}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) onAdd([...e.target.files]);
          e.target.value = '';
        }}
      />
      {shownError && <div className="error-box">{shownError}</div>}
    </div>
  );
}
