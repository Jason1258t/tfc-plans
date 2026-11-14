import { useEffect, useState } from 'react';
import { useTasks } from '@/entities/task';
import { ErrorBox } from '@/shared/ui';
import { downloadReport, removeReport, useReports, type Report } from '../model/reports';
import { ReportList } from './ReportList';

export function DevReports({
  kind,
  focusId,
  onKind,
}: {
  kind: 'crash' | 'log';
  focusId: string | null;
  /** Ссылка ?report=<id> на лог: переключить вкладку */
  onKind: (kind: 'crash' | 'log') => void;
}) {
  const { reports, loading, error: loadError, reload } = useReports();
  const { items: tasks } = useTasks();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (r: Report, action: (r: Report) => Promise<unknown>) => {
    setBusyId(r.id);
    setError(null);
    try {
      await action(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };
  // Ссылка на конкретный отчёт сама выбирает его тип после загрузки списка.
  const selected = reports.find((r) => r.id === focusId)?.report.kind ?? kind;
  useEffect(() => {
    if (selected !== kind) onKind(selected);
  }, [selected, kind, onKind]);
  return (
    <>
      {(error || loadError) && <ErrorBox>{error || loadError}</ErrorBox>}
      {loading ? (
        <p>Загружаю отчёты…</p>
      ) : (
        <ReportList
          kind={selected}
          files={reports.filter((r) => r.report.kind === selected)}
          taskById={new Map(tasks.map((t) => [t.id, t]))}
          focusId={focusId}
          busyId={busyId}
          onDownload={(r) => void run(r, downloadReport)}
          onRemove={(r) => void run(r, (x) => removeReport(x).then(reload))}
        />
      )}
    </>
  );
}
