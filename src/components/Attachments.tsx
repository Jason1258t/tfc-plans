import { Download, File as FileIcon, FileArchive, Paperclip, Trash2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useData } from '../data/DataContext';
import {
  downloadFile,
  filesEnabled,
  formatSize,
  MAX_FILE_SIZE,
  removeFile,
  uploadFile,
  type FileMeta,
} from '../lib/files';
import { cx, timeAgo } from '../lib/util';
import './Attachments.css';

type Props =
  /** Файлы существующей задачи — грузятся сразу */
  | { taskId: string; pending?: never; onPendingChange?: never }
  /** Черновик новой задачи — файлы копятся и загружаются после «Создать» */
  | { taskId?: never; pending: File[]; onPendingChange: (files: File[]) => void };

interface Upload {
  key: string;
  name: string;
  progress: number;
  error?: string;
}

const isArchive = (name: string) => /\.(zip|jar|rar|7z|gz|tar)$/i.test(name);

export function Attachments(props: Props) {
  const { files, nick } = useData();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const attached = props.taskId
    ? files.filter((f) => f.taskId === props.taskId).sort((a, b) => a.createdAt - b.createdAt)
    : [];

  const add = (list: FileList | File[]) => {
    setError(null);
    const arr = [...list];
    const tooBig = arr.filter((f) => f.size > MAX_FILE_SIZE);
    if (tooBig.length) setError(`Больше ${formatSize(MAX_FILE_SIZE)}: ${tooBig.map((f) => f.name).join(', ')}`);
    const ok = arr.filter((f) => f.size <= MAX_FILE_SIZE);
    if (!ok.length) return;
    if (props.pending) return props.onPendingChange([...props.pending, ...ok]);
    for (const file of ok) {
      const key = `${file.name}-${Date.now()}-${Math.random()}`;
      setUploads((u) => [...u, { key, name: file.name, progress: 0 }]);
      uploadFile(file, { taskId: props.taskId, author: nick }, (p) =>
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: p } : x))),
      ).then(
        () => setUploads((u) => u.filter((x) => x.key !== key)),
        (e) =>
          setUploads((u) =>
            u.map((x) => (x.key === key ? { ...x, error: e instanceof Error ? e.message : String(e) } : x)),
          ),
      );
    }
  };

  const download = async (f: FileMeta) => {
    setBusyId(f.id);
    setError(null);
    try {
      await downloadFile(f);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (f: FileMeta) => {
    if (!confirm(`Удалить файл «${f.name}»?`)) return;
    setBusyId(f.id);
    try {
      await removeFile(f);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  if (!filesEnabled) return <div className="faint small">Вложения доступны, когда подключён Firebase.</div>;

  const empty = !attached.length && !uploads.length && !props.pending?.length;

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
        if (e.dataTransfer.files.length) add(e.dataTransfer.files);
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
              <button className="attach-name" onClick={() => download(f)} title="Скачать">
                {f.name}
              </button>
              <span className="faint small attach-meta">
                {formatSize(f.size)} · {f.author} · {timeAgo(f.createdAt)}
              </span>
              <button
                className="btn ghost sm icon"
                onClick={() => download(f)}
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
          {props.pending?.map((f, i) => (
            <li key={`${f.name}-${i}`} className="attach-row">
              <FileIcon size={18} className="attach-ico" />
              <span className="attach-name static">{f.name}</span>
              <span className="faint small attach-meta">{formatSize(f.size)} · загрузится при создании</span>
              <button
                className="btn ghost sm icon"
                onClick={() => props.onPendingChange(props.pending.filter((_, j) => j !== i))}
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
                  <button
                    className="btn ghost sm icon"
                    onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}
                    aria-label="Скрыть"
                  >
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
          if (e.target.files) add(e.target.files);
          e.target.value = '';
        }}
      />
      {error && <div className="error-box">{error}</div>}
    </div>
  );
}
