import { Check, Copy, Download, Search as SearchIcon, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileBadge } from '../../../../components/FileBadge';
import { formatSize, type FileMeta } from '@/entities/file';
import type { Task } from '@/entities/task';
import { cx, timeAgo } from '@/shared/lib';
import { Button, Search } from '@/shared/ui';
import styles from './ReportList.module.css';

interface Props {
  kind: 'crash' | 'log';
  files: FileMeta[];
  taskById: Map<string, Task>;
  /** ?report=<id> — подсветить и прокрутить */
  focusId: string | null;
  busyId: string | null;
  onDownload: (f: FileMeta) => void;
  onRemove: (f: FileMeta) => void;
}

/** Строка для агента: по ней MCP report_get находит отчёт (её же печатает tfc report) */
const agentLine = (f: FileMeta) => `Отчёт «${f.name}» — tfc-report:${f.id} — ${location.origin}/dev?report=${f.id}`;

/** Служебный подраздел «Разработки»: логи или краш-репорты, загруженные из игры командой tfc report */
export function ReportList({ kind, files, taskById, focusId, busyId, onDownload, onRemove }: Props) {
  const [q, setQ] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const focusRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: 'center' });
  }, [focusId, files.length]);

  const copy = async (f: FileMeta) => {
    const text = agentLine(f);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(f.id);
      setTimeout(() => setCopied((c) => (c === f.id ? null : c)), 1500);
    } catch {
      prompt('Скопируйте вручную:', text);
    }
  };

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = files.filter((f) => {
    const r = f.report!;
    const hay = `${f.name}\n${f.author}\n${r.label}\n${r.note}\n${r.files.map((x) => x.name).join('\n')}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });

  return (
    <>
      <p className={cx('faint', 'small', styles.filesNote)}>
        {kind === 'crash' ? 'Краш-репорты игры и сервера' : 'Логи игры, сервера и KubeJS'} — загружаются из папки игры
        командой <code>tfc report</code>. Кнопка <Copy size={12} /> копирует строку для агента: по ней он сам скачает и
        разберёт файл.
      </p>
      {files.length > 0 && (
        <div className={styles.filesBar} role="search" aria-label="Поиск по отчётам">
          <Search className={styles.filesSearch}>
            <SearchIcon size={15} className="faint" />
            <input
              placeholder="Имя файла, автор, описание"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Поиск по отчётам"
            />
          </Search>
        </div>
      )}
      {shown.length === 0 ? (
        <div className="empty">
          {files.length ? 'Ничего не найдено' : 'Пока пусто. Загрузить из игры: в терминале tfc report'}
        </div>
      ) : (
        <ul className={styles.filesList}>
          {shown.map((f) => {
            const r = f.report!;
            const task = f.taskId ? taskById.get(f.taskId) : undefined;
            const inner = r.files.length > 1 ? r.files.map((x) => x.name.split('/').pop()).join(', ') : '';
            return (
              <li
                key={f.id}
                ref={f.id === focusId ? focusRef : undefined}
                className={cx(styles.filesRow, f.id === focusId && styles.filesFocus)}
              >
                <FileBadge
                  className={styles.fileBadge}
                  name={f.name}
                  type={f.type}
                  onOpen={() => onDownload(f)}
                  disabled={busyId === f.id}
                >
                  {r.label} · {formatSize(f.size)} · {f.author}, {timeAgo(f.createdAt)}
                  {r.files.length > 1 && ` · файлов: ${r.files.length}`}
                  {task && (
                    <>
                      {' · '}
                      <Link to={`/?task=${task.id}`}>↳ {task.title}</Link>
                    </>
                  )}
                  {r.note && <span className={styles.reportNote}>«{r.note}»</span>}
                  {inner && (
                    <span className={cx(styles.reportFiles, 'faint')} title={inner}>
                      {inner}
                    </span>
                  )}
                </FileBadge>
                <Button
                  variant="ghost"
                  size="sm"
                  icon
                  onClick={() => copy(f)}
                  aria-label={`Скопировать для агента: ${f.name}`}
                  title="Скопировать для агента (id и ссылка)"
                >
                  {copied === f.id ? <Check size={15} /> : <Copy size={15} />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon
                  onClick={() => onDownload(f)}
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
                  onClick={() => confirm(`Удалить «${f.name}»?`) && onRemove(f)}
                  disabled={busyId === f.id}
                  aria-label={`Удалить ${f.name}`}
                  title="Удалить"
                >
                  <Trash2 size={15} />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
