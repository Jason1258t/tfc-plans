import { Download, Search as SearchIcon, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileBadge, FileKindDot } from '../../components/FileBadge';
import { useNick } from '@/entities/user';
import { useFiles } from '@/entities/file';
import { useTasks } from '@/entities/task';
import { schematicsStore } from '@/entities/schematic';
import { downloadFile, filesEnabled, formatSize, MAX_FILE_SIZE, removeFile, uploadFile } from '@/entities/file';
import { FILE_KINDS, fileKind, type FileKind } from '../../lib/fileKinds';
import { prepareFile, validateFiles } from '../../lib/uploads';
import { cx, timeAgo } from '@/shared/lib';
import type { SavedSchematic } from '@/entities/schematic';
import { Search, Segmented, Button, ErrorBox } from '@/shared/ui';
import { ReportList } from './ui/ReportList';
import styles from './FilesPage.module.css';

const KINDS: { id: FileKind | 'all'; label: string }[] = [{ id: 'all', label: 'Все' }, ...FILE_KINDS];

/** Подразделы: обычные файлы и служебные — отчёты из игры (tfc report) */
type Section = 'files' | 'crash' | 'log';
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'files', label: 'Файлы' },
  { id: 'crash', label: 'Краш-репорты' },
  { id: 'log', label: 'Логи' },
];

/** Всё файловое хранилище сайта: вложения задач, исходники библиотеки схем, файлы без привязки */
export function FilesPage() {
  const { items: files } = useFiles();
  const { items: tasks, loading } = useTasks();
  const nick = useNick();
  const [schematics, setSchematics] = useState<SavedSchematic[]>([]);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<FileKind | 'all'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<{ name: string; progress: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [params, setParams] = useSearchParams();
  const focusId = params.get('report');
  const focusKind = focusId ? files.find((f) => f.id === focusId)?.report?.kind : undefined;
  const asked = params.get('section');
  const section: Section =
    asked === 'crash' || asked === 'log' ? asked : asked === 'files' ? 'files' : (focusKind ?? 'files');
  const setSection = (s: Section) => setParams(s === 'files' ? {} : { section: s }, { replace: true });
  const reports = useMemo(() => files.filter((f) => f.report?.kind), [files]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  useEffect(() => schematicsStore.subscribe(setSchematics), []);

  const rows = useMemo(() => {
    const schemByFile = new Map(schematics.map((s) => [s.fileId, s]));
    return files
      .filter((f) => !f.report?.kind)
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
  }, [files, taskById, schematics]);

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows.filter((r) => (kind === 'all' || r.kind === kind) && words.every((w) => r.hay.includes(w)));
  const total = files.reduce((n, f) => n + f.size, 0);
  const reportsOf = (k: 'crash' | 'log') => reports.filter((f) => f.report!.kind === k);

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
            Всё, что лежит в хранилище сайта: вложения задач, исходники библиотеки схем, файлы без привязки и служебные
            отчёты из игры.
            {files.length > 0 && ` Всего ${files.length}, ${formatSize(total)}.`}
          </p>
        </div>
        {section === 'files' && (
          <Button variant="primary" onClick={() => inputRef.current?.click()} disabled={Boolean(uploading)}>
            <Upload size={16} />
            Загрузить
          </Button>
        )}
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

      <Segmented
        tabs
        role="tablist"
        label="Подраздел документов"
        value={section}
        onChange={setSection}
        options={SECTIONS.map((x) => ({
          value: x.id,
          label: x.label,
          count: x.id === 'files' ? rows.length : reportsOf(x.id).length,
        }))}
      />

      {uploading && (
        <p className={cx(styles.filesUploading, 'small')}>
          Загружаю «{uploading.name}» — {Math.round(uploading.progress * 100)}%
        </p>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
      {error && <ErrorBox>{error}</ErrorBox>}

      {section !== 'files' ? (
        loading ? (
          <div className="empty">Загрузка…</div>
        ) : (
          <ReportList
            kind={section}
            files={reportsOf(section)}
            taskById={taskById}
            focusId={focusId}
            busyId={busyId}
            onDownload={(f) => run(f.id, () => downloadFile(f))}
            onRemove={(f) => run(f.id, () => removeFile(f))}
          />
        )
      ) : (
        <>
          <div className={styles.filesBar} role="search" aria-label="Поиск и фильтр файлов">
            <Search className={styles.filesSearch}>
              <SearchIcon size={15} className="faint" />
              <input
                autoFocus
                placeholder="Имя файла, автор, задача или схема"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Поиск по файлам"
              />
            </Search>
            <Segmented
              className={styles.filesSeg}
              value={kind}
              onChange={setKind}
              options={KINDS.flatMap((k) => {
                const count = k.id === 'all' ? rows.length : rows.filter((r) => r.kind === k.id).length;
                // Виды, которых в хранилище нет, не показываем — кроме выбранного
                if (!count && k.id !== 'all' && k.id !== kind) return [];
                return [
                  {
                    value: k.id,
                    label: k.label,
                    count,
                    icon: k.id !== 'all' ? <FileKindDot kind={k.id} /> : undefined,
                  },
                ];
              })}
            />
          </div>

          {uploading && (
            <p className={cx(styles.filesUploading, 'small')}>
              Загружаю «{uploading.name}» — {Math.round(uploading.progress * 100)}%
            </p>
          )}
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
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    onClick={() => run(f.id, () => downloadFile(f))}
                    disabled={busyId === f.id}
                    aria-label={`Скачать ${f.name}`}
                    title="Скачать"
                  >
                    <Download size={15} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    onClick={() => confirm(`Удалить файл «${f.name}»?`) && run(f.id, () => removeFile(f))}
                    disabled={busyId === f.id || Boolean(schematic)}
                    aria-label={`Удалить ${f.name}`}
                    title={schematic ? 'Исходник схемы — удаляется вместе со схемой в библиотеке' : 'Удалить'}
                  >
                    <Trash2 size={15} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className={cx('faint', 'small', styles.filesNote)}>Один файл — до {formatSize(MAX_FILE_SIZE)}.</p>
        </>
      )}
    </main>
  );
}
