import { useState } from 'react';
import { downloadFile, removeFile, useFiles, type FileMeta } from '@/entities/file';
import { useTasks } from '@/entities/task';
import { ErrorBox } from '@/shared/ui';
import { ReportList } from './ReportList';

export function DevReports({ kind, focusId }: { kind: 'crash' | 'log'; focusId: string | null }) {
  const { items: files, loading, error: filesError } = useFiles();
  const { items: tasks } = useTasks();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (file: FileMeta, action: (f: FileMeta) => Promise<unknown>) => {
    setBusyId(file.id);
    setError(null);
    try {
      await action(file);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };
  // Ссылка на конкретный отчёт сама выбирает его тип после загрузки метаданных.
  const selected = files.find((f) => f.id === focusId)?.report?.kind ?? kind;
  return (
    <>
      {(error || filesError) && <ErrorBox>{error || filesError}</ErrorBox>}
      {loading ? (
        <p>Загружаю отчёты…</p>
      ) : (
        <ReportList
          kind={selected}
          files={files.filter((f) => f.report?.kind === selected)}
          taskById={new Map(tasks.map((t) => [t.id, t]))}
          focusId={focusId}
          busyId={busyId}
          onDownload={(f) => void run(f, downloadFile)}
          onRemove={(f) => void run(f, removeFile)}
        />
      )}
    </>
  );
}
