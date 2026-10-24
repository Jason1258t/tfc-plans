import { Download, Search, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileBadge, FileKindDot } from '../../components/FileBadge';
import { useData } from '../../data/DataContext';
import { schematicsStore } from '@/shared/api';
import { downloadFile, filesEnabled, formatSize, MAX_FILE_SIZE, removeFile, uploadFile } from '../../lib/files';
import { FILE_KINDS, fileKind, type FileKind } from '../../lib/fileKinds';
import { prepareFile, validateFiles } from '../../lib/uploads';
import { cx, timeAgo } from '@/shared/lib';
import type { SavedSchematic } from '../../types';
import styles from './FilesPage.module.css';

const KINDS: { id: FileKind | 'all'; label: string }[] = [{ id: 'all', label: 'Все' }, ...FILE_KINDS];

/** Всё файловое хранилище сайта: вложения задач, исходники библиотеки схем, файлы без привязки */
export function FilesPage() {
  const { files, tasks, nick, loading } = useData();
  const [schematics, setSchematics] = useState<SavedSchematic[]>([]);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<FileKind | 'all'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<{ name: string; progress: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => schematicsStore.subscribe(setSchematics), []);

  const rows = useMemo(() => {
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const schemByFile = new Map(schematics.map((s) => [s.fileId, s]));
    return files
      .map((f) => {
        const task = f.taskId ? taskById.get(f.taskId) : undefined;
        const schematic = schemByFile.get(f.id);
        return {
          file: f,
          kind: fileKind(f),
          task,
          schematic,
          hay: `${f.name}\n${f.author}\n${task?.title ?? ''}\n${schematic?.name ?? ''}`.toLowerCase(),
        };
      })
      .sort((a, b) => b.file.createdAt - a.file.createdAt);
  }, [files, tasks, schematics]);

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows.filter((r) => (kind === 'all' || r.kind === kind) && words.every((w) => r.hay.includes(w)));
  const total = files.reduce((n, f) => n + f.size, 0);

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const add = async (picked: File[]) => {
    const { ok, error: sizeError } = validateFiles(picked);
    setError(sizeError);
    for (const raw of ok) {
      try {
        const file = await prepareFile(raw);
        setUploading({ name: file.name, progress: 0 });
        await uploadFile(file, { taskId: null, author: nick }, (progress) =>
          setUploading({ name: file.name, progress }),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    setUploading(null);
  };

  if (!filesEnabled)
    return (
      <main className={styles.filesPage}>
        <h1>Документы</h1>
        <div className="empty">Хранилище файлов доступно, когда подключён Firebase.</div>
      </main>
    );

  return (
    <main className={styles.filesPage}>
      <div className={styles.filesHead}>
        <div className="grow">
          <h1>Документы</h1>
          <p className="faint small">
            Всё, что лежит в хранилище сайта: вложения задач, исходники библиотеки схем и файлы без привязки.
            {files.length > 0 && ` Всего ${files.length}, ${formatSize(total)}.`}
          </p>
        </div>
        <button className="btn primary" onClick={() => inputRef.current?.click()} disabled={Boolean(uploading)}>
          <Upload size={16} />
          Загрузить
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const picked = [...(e.target.files ?? [])];
            e.target.value = '';
            if (picked.length) add(picked);
          }}
        />
      </div>

      <div className={styles.filesBar} role="search" aria-label="Поиск и фильтр файлов">
        <label className="search">
          <Search size={15} className="faint" />
          <input
            autoFocus
            placeholder="Имя файла, автор, задача или схема"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Поиск по файлам"
          />
        </label>
        <span className="seg">
          {KINDS.map((k) => {
            const count = k.id === 'all' ? rows.length : rows.filter((r) => r.kind === k.id).length;
            // Виды, которых в хранилище нет, не показываем — кроме выбранного
            if (!count && k.id !== 'all' && k.id !== kind) return null;
            return (
              <button key={k.id} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
                {k.id !== 'all' && <FileKindDot kind={k.id} />}
                {k.label}
                <span className="count">{count}</span>
              </button>
            );
          })}
        </span>
      </div>

      {uploading && (
        <p className={cx(styles.filesUploading, 'small')}>
          Загружаю «{uploading.name}» — {Math.round(uploading.progress * 100)}%
        </p>
      )}
      {error && <div className="error-box">{error}</div>}

      {loading ? (
        <div className="empty">Загрузка…</div>
      ) : shown.length === 0 ? (
        <div className="empty">{rows.length ? 'Ничего не найдено' : 'Файлов пока нет'}</div>
      ) : (
        <ul className={styles.filesList}>
          {shown.map(({ file: f, task, schematic }) => (
            <li key={f.id} className={styles.filesRow}>
              <FileBadge
                name={f.name}
                type={f.type}
                onOpen={() => run(f.id, () => downloadFile(f))}
                disabled={busyId === f.id}
              >
                {formatSize(f.size)} · {f.author}, {timeAgo(f.createdAt)} ·{' '}
                {schematic ? (
                  <Link to="/schematics">библиотека схем: {schematic.name}</Link>
                ) : task ? (
                  <Link to={`/?task=${task.id}`}>↳ {task.title}</Link>
                ) : f.taskId ? (
                  'задача удалена'
                ) : (
                  'без привязки'
                )}
              </FileBadge>
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
                className="btn ghost sm icon"
                onClick={() => confirm(`Удалить файл «${f.name}»?`) && run(f.id, () => removeFile(f))}
                disabled={busyId === f.id || Boolean(schematic)}
                aria-label={`Удалить ${f.name}`}
                title={schematic ? 'Исходник схемы — удаляется вместе со схемой в библиотеке' : 'Удалить'}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className={cx('faint', 'small', styles.filesNote)}>Один файл — до {formatSize(MAX_FILE_SIZE)}.</p>
    </main>
  );
}
