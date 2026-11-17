import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatSize } from '@/entities/file';
import { Button, ErrorBox } from '@/shared/ui';
import { devApi, type DevFile } from '../model/api';
import { downloadDevFile, readDevFile } from '../model/files';
import {
  isDevReport,
  listReportEntries,
  MAX_ENTRY_BYTES,
  readReportEntry,
  reportImageType,
  reportTitle,
  type ReportEntry,
} from '../model/reportArchive';
import styles from './DevReportPage.module.css';

type Archive = { file: DevFile; data: Uint8Array; entries: ReportEntry[] };

export function DevReportPage() {
  const { task, file } = useParams();
  return <ReportLoader key={`${task}/${file}`} task={task ?? ''} id={file ?? ''} />;
}

function ReportLoader({ task, id }: { task: string; id: string }) {
  const [archive, setArchive] = useState<Archive>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!/^\d+$/.test(task) || !Number.isSafeInteger(Number(task))) throw new Error('Задача не найдена.');
      const full = await devApi.get(Number(task));
      const file = full.files?.find((item) => item.id === id && isDevReport(item.name));
      if (!file) throw new Error('Отчёт не найден в этой задаче.');
      if (!active) return;
      const data = new Uint8Array(await (await readDevFile(file)).arrayBuffer());
      if (!active) return;
      const entries = await listReportEntries(data).catch(() => {
        throw new Error('Не удалось прочитать ZIP-архив.');
      });
      if (active) setArchive({ file, data, entries });
    }
    void load().catch((e: Error) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [task, id, attempt]);

  return (
    <main className={styles.page}>
      <Link to={/^\d+$/.test(task) ? `/dev?task=${task}` : '/dev'}>← К задаче {task && `#${task}`}</Link>
      {error ? (
        <>
          <ErrorBox>{error}</ErrorBox>
          <Button
            onClick={() => {
              setError('');
              setAttempt(attempt + 1);
            }}
          >
            Повторить
          </Button>
        </>
      ) : archive ? (
        <ReportViewer archive={archive} />
      ) : (
        <p role="status">Загрузка отчёта…</p>
      )}
    </main>
  );
}

const GALLERY_PAGE_SIZE = 12;
const IMAGE_LIMIT = 12 * 1024 * 1024;
const TEXT_LIMIT = 2 * 1024 * 1024;

function ReportViewer({ archive: { file, data, entries } }: { archive: Archive }) {
  const images = entries.filter((entry) => reportImageType(entry.name));
  const [selected, setSelected] = useState<ReportEntry>();
  const [galleryPage, setGalleryPage] = useState(0);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const matches = entries.filter((entry) => entry.name.toLowerCase().includes(query.trim().toLowerCase()));

  async function downloadZip() {
    setError('');
    setDownloading(true);
    try {
      await downloadDevFile(file);
    } catch {
      setError('Не удалось скачать ZIP.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <header className={styles.header}>
        <div>
          <h1>{reportTitle(file.name)}</h1>
          <span className="faint small">
            ZIP-отчёт · {file.author} · {formatSize(file.size)}
          </span>
        </div>
        <Button onClick={() => void downloadZip()} disabled={downloading}>
          Скачать ZIP
        </Button>
      </header>
      {error && <ErrorBox>{error}</ErrorBox>}
      {!entries.length ? (
        <p>В архиве нет файлов.</p>
      ) : (
        <div className={styles.layout}>
          <aside className={styles.sidebar} aria-label="Содержимое ZIP">
            <h2>Файлы в ZIP · {entries.length}</h2>
            {!!images.length && (
              <Button variant={selected ? 'ghost' : undefined} onClick={() => setSelected(undefined)}>
                Галерея · {images.length}
              </Button>
            )}
            <input
              className={styles.search}
              type="search"
              aria-label="Поиск по путям файлов"
              placeholder="Поиск по пути"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <ul className={styles.entries}>
              {matches.map((entry) => (
                <li key={entry.index}>
                  <button
                    type="button"
                    aria-current={selected === entry ? 'true' : undefined}
                    onClick={() => setSelected(entry)}
                  >
                    <span>{entry.name}</span>
                    <small>{formatSize(entry.originalSize)}</small>
                  </button>
                </li>
              ))}
            </ul>
            {!matches.length && <p className="faint small">Файлы не найдены.</p>}
          </aside>
          <section className={styles.preview} aria-label="Просмотр отчёта">
            {selected ? (
              <EntryPreview key={selected.index} data={data} entry={selected} />
            ) : images.length ? (
              <>
                <h2>Галерея изображений</h2>
                <div className={styles.gallery}>
                  {images.slice(galleryPage * GALLERY_PAGE_SIZE, (galleryPage + 1) * GALLERY_PAGE_SIZE).map((entry) => (
                    <button type="button" key={entry.index} onClick={() => setSelected(entry)}>
                      <GalleryImage data={data} entry={entry} />
                      <span>{entry.name}</span>
                    </button>
                  ))}
                </div>
                {images.length > GALLERY_PAGE_SIZE && (
                  <div className={styles.pager}>
                    <Button onClick={() => setGalleryPage(galleryPage - 1)} disabled={!galleryPage}>
                      Назад
                    </Button>
                    <span>
                      {galleryPage + 1} / {Math.ceil(images.length / GALLERY_PAGE_SIZE)}
                    </span>
                    <Button
                      onClick={() => setGalleryPage(galleryPage + 1)}
                      disabled={(galleryPage + 1) * GALLERY_PAGE_SIZE >= images.length}
                    >
                      Далее
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <p>Выберите файл для просмотра.</p>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function GalleryImage({ data, entry }: { data: Uint8Array; entry: ReportEntry }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (entry.originalSize > IMAGE_LIMIT) return;
    let active = true;
    let objectUrl = '';
    void readReportEntry(data, entry).then(
      (bytes) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: reportImageType(entry.name) }));
        setUrl(objectUrl);
      },
      () => active && setFailed(true),
    );
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [data, entry]);

  if (failed || entry.originalSize > IMAGE_LIMIT) return <small>Миниатюра недоступна</small>;
  return url ? <img src={url} alt="" onError={() => setFailed(true)} /> : <small>Загрузка…</small>;
}

function EntryPreview({ data, entry }: { data: Uint8Array; entry: ReportEntry }) {
  const imageType = reportImageType(entry.name);
  const canExtract = entry.originalSize <= MAX_ENTRY_BYTES && entry.size <= MAX_ENTRY_BYTES;
  const canPreview = canExtract && (!imageType || entry.originalSize <= IMAGE_LIMIT);
  const [preview, setPreview] = useState<{ kind: 'image' | 'text'; value: string } | null>();
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!canPreview) return;
    let active = true;
    let url = '';
    void readReportEntry(data, entry).then(
      (bytes) => {
        if (!active) return;
        if (imageType) {
          url = URL.createObjectURL(new Blob([bytes], { type: imageType }));
          setPreview({ kind: 'image', value: url });
        } else {
          const decoder = new TextDecoder(
            bytes[0] === 0xff && bytes[1] === 0xfe
              ? 'utf-16le'
              : bytes[0] === 0xfe && bytes[1] === 0xff
                ? 'utf-16be'
                : 'utf-8',
            { fatal: true },
          );
          try {
            const text = decoder.decode(bytes.subarray(0, TEXT_LIMIT), { stream: bytes.length > TEXT_LIMIT });
            const hasBinaryControls = [...text.slice(0, 8192)].some((char) => {
              const code = char.charCodeAt(0);
              return code < 32 && !'\t\n\r\f\x1b'.includes(char);
            });
            setPreview(hasBinaryControls ? null : { kind: 'text', value: text });
          } catch {
            setPreview(null);
          }
        }
      },
      () => active && setError('Не удалось распаковать файл.'),
    );
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [canPreview, data, entry, imageType]);

  async function download() {
    setDownloading(true);
    try {
      const bytes = await readReportEntry(data, entry);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = entry.name.split(/[\\/]/).pop() || 'file';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setError('Не удалось скачать файл.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <header className={styles.entryHeader}>
        <div>
          <h2>{entry.name}</h2>
          <span className="faint small">{formatSize(entry.originalSize)}</span>
        </div>
        {canExtract && (
          <Button onClick={() => void download()} disabled={downloading}>
            Скачать файл
          </Button>
        )}
      </header>
      {error && <ErrorBox>{error}</ErrorBox>}
      {!error &&
        (!canPreview ? (
          <p>{canExtract ? 'Файл слишком большой для просмотра.' : 'Файл доступен в полном ZIP.'}</p>
        ) : preview === undefined ? (
          <p role="status">Распаковка…</p>
        ) : preview === null ? (
          <p>Для этого формата доступно скачивание.</p>
        ) : preview.kind === 'image' ? (
          <img
            className={styles.image}
            src={preview.value}
            alt={entry.name}
            onError={() => setError('Не удалось показать изображение.')}
          />
        ) : (
          <>
            {entry.originalSize > TEXT_LIMIT && (
              <p className="faint small">Показано начало файла ({formatSize(TEXT_LIMIT)}).</p>
            )}
            <TextPreview name={entry.name} text={preview.value} />
          </>
        ))}
    </>
  );
}

function TextPreview({ name, text }: { name: string; text: string }) {
  const parent = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!parent.current) return;
    const view = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({ tabindex: '0', 'aria-label': name }),
          lineNumbers(),
          syntaxHighlighting(defaultHighlightStyle),
          ...(/\.(md|markdown)$/i.test(name) ? [markdown()] : []),
        ],
      }),
    });
    return () => view.destroy();
  }, [name, text]);

  return <div className={styles.editor} ref={parent} />;
}
