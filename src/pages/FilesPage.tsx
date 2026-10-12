import {
  Download,
  File as FileIcon,
  FileArchive,
  FileBox,
  FileCode,
  FileText,
  Image,
  Package,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../data/DataContext';
import { schematicsStore } from '../data/store';
import {
  downloadFile,
  filesEnabled,
  formatSize,
  MAX_FILE_SIZE,
  removeFile,
  uploadFile,
  type FileMeta,
} from '../lib/files';
import { isImage, prepareFile, validateFiles } from '../lib/uploads';
import { timeAgo } from '../lib/util';
import type { SavedSchematic } from '../types';
import './FilesPage.css';

type Kind = 'image' | 'schematic' | 'archive' | 'mod' | 'code' | 'text' | 'other';
const KINDS: { id: Kind | 'all'; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'image', label: 'Картинки' },
  { id: 'schematic', label: 'Схемы' },
  { id: 'archive', label: 'Архивы' },
  { id: 'mod', label: 'Моды' },
  { id: 'code', label: 'Скрипты и данные' },
  { id: 'text', label: 'Тексты' },
  { id: 'other', label: 'Остальное' },
];

const BY_EXT: [RegExp, Kind][] = [
  [/\.(nbt|schem|litematic)$/i, 'schematic'],
  [/\.jar$/i, 'mod'],
  [/\.(zip|rar|7z|gz|tar)$/i, 'archive'],
  [/\.(js|ts|json5?|toml|ya?ml|cfg|properties|mcfunction|mcmeta|snbt|csv|xml)$/i, 'code'],
  [/\.(txt|md|pdf|docx?|rtf|log)$/i, 'text'],
];

const kindOf = (f: FileMeta): Kind => (isImage(f) ? 'image' : (BY_EXT.find(([re]) => re.test(f.name))?.[1] ?? 'other'));

/** Значок вида файла; цвет задаётся классом files-ico.<вид> */
const ICONS = {
  image: Image,
  schematic: FileBox,
  archive: FileArchive,
  mod: Package,
  code: FileCode,
  text: FileText,
  other: FileIcon,
};

/** Всё файловое хранилище сайта: вложения задач, исходники библиотеки схем, файлы без привязки */
export function FilesPage() {
  const { files, tasks, nick, loading } = useData();
  const [schematics, setSchematics] = useState<SavedSchematic[]>([]);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind | 'all'>('all');
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
          kind: kindOf(f),
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
      <main className="files-page">
        <h1>Документы</h1>
        <div className="empty">Хранилище файлов доступно, когда подключён Firebase.</div>
      </main>
    );

  return (
    <main className="files-page">
      <div className="files-head">
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

      <div className="files-bar">
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
                {k.id !== 'all' && <span className={`files-dot ${k.id}`} aria-hidden />}
                {k.label}
                <span className="count">{count}</span>
              </button>
            );
          })}
        </span>
      </div>

      {uploading && (
        <p className="files-uploading small">
          Загружаю «{uploading.name}» — {Math.round(uploading.progress * 100)}%
        </p>
      )}
      {error && <div className="error-box">{error}</div>}

      {loading ? (
        <div className="empty">Загрузка…</div>
      ) : shown.length === 0 ? (
        <div className="empty">{rows.length ? 'Ничего не найдено' : 'Файлов пока нет'}</div>
      ) : (
        <ul className="files-list">
          {shown.map(({ file: f, kind: k, task, schematic }) => {
            const Icon = ICONS[k];
            return (
              <li key={f.id} className="files-row">
                <span className={`files-ico ${k}`}>
                  <Icon size={18} />
                </span>
                <span className="files-main">
                  <button
                    className="files-name"
                    onClick={() => run(f.id, () => downloadFile(f))}
                    disabled={busyId === f.id}
                    title="Скачать"
                  >
                    {f.name}
                  </button>
                  <span className="files-meta">
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
                  </span>
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
                  className="btn ghost sm icon"
                  onClick={() => confirm(`Удалить файл «${f.name}»?`) && run(f.id, () => removeFile(f))}
                  disabled={busyId === f.id || Boolean(schematic)}
                  aria-label={`Удалить ${f.name}`}
                  title={schematic ? 'Исходник схемы — удаляется вместе со схемой в библиотеке' : 'Удалить'}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="faint small files-note">Один файл — до {formatSize(MAX_FILE_SIZE)}.</p>
    </main>
  );
}
