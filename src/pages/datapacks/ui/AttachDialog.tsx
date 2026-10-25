import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNick } from '@/entities/user';
import { useTasks } from '@/entities/task';
import { useGroups } from '@/entities/group';
import { buildZip, zipName } from '@/lib/datapack';
import { uploadFile } from '@/entities/file';
import { Modal, Button } from '@/shared/ui';
import type { Datapack } from '@/entities/datapack';

/** Собрать zip и приложить к задаче — хост скачает его оттуда */
export function AttachDialog({ pack, onClose }: { pack: Datapack; onClose: () => void }) {
  const { items: tasks } = useTasks();
  const { items: groups } = useGroups();
  const nick = useNick();
  const navigate = useNavigate();
  const [taskId, setTaskId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const active = tasks.filter((t) => t.status !== 'done').sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  const groupName = (id: string | null) => groups.find((g) => g.id === id)?.name;

  const attach = async () => {
    setBusy(true);
    setError(null);
    try {
      const file = new File([buildZip(pack) as BlobPart], zipName(pack), { type: 'application/zip' });
      await uploadFile(file, { taskId, author: nick });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      narrow
      title="Приложить zip к задаче"
      footer={
        done ? (
          <>
            <span className="grow" />
            <Button onClick={onClose}>Закрыть</Button>
            <Button variant="primary" onClick={() => navigate(`/?task=${taskId}`)}>
              Открыть задачу
            </Button>
          </>
        ) : (
          <>
            <span className="grow" />
            <Button variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <Button variant="primary" onClick={attach} disabled={!taskId || busy}>
              {busy ? 'Загружаю…' : 'Приложить'}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <p style={{ margin: 0 }}>
          <b>{zipName(pack)}</b> приложен к задаче. Текущая версия датапака сохранена в файле — если поменяете его,
          приложите заново.
        </p>
      ) : (
        <>
          <label className="label" htmlFor="att-task">
            Задача
          </label>
          <select id="att-task" className="input" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">— выберите —</option>
            {active.map((t) => (
              <option key={t.id} value={t.id}>
                {groupName(t.groupId) ? `${groupName(t.groupId)} · ` : ''}
                {t.title}
              </option>
            ))}
          </select>
          {error && <div className="error-box">{error}</div>}
        </>
      )}
    </Modal>
  );
}
