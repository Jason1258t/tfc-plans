import { useEffect, useState } from 'react';
import { Markdown } from '@/components/Markdown';
import { useNick } from '@/entities/user';
import { timeAgo } from '@/shared/lib';
import { Button, ErrorBox, Input, Modal, Textarea } from '@/shared/ui';
import { DevError, devApi, type DevDoc } from '../model/api';
import styles from './DevTaskDialog.module.css';

/** План задачи разработки: просмотр markdown и правка целиком (последняя запись не затирает чужую — rev) */
export function DevDocDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const nick = useNick();
  const [doc, setDoc] = useState<DevDoc | null>(null);
  const [edit, setEdit] = useState<{ title: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    devApi.doc(id).then(
      (d) => {
        setDoc(d);
        if (!d.content) setEdit({ title: d.title, content: '' });
      },
      (e) => setError((e as Error).message),
    );
  }, [id]);

  const save = async () => {
    if (!doc || !edit) return;
    setBusy(true);
    setError(null);
    try {
      setDoc(await devApi.saveDoc(doc.id, doc.rev, edit, nick));
      setEdit(null);
    } catch (e) {
      setError(
        e instanceof DevError && e.status === 409
          ? 'План изменили, пока вы его правили. Скопируйте свой текст и откройте план заново.'
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  const dirty = !!doc && !!edit && (edit.title !== doc.title || edit.content !== (doc.content ?? ''));

  return (
    <Modal
      wide
      onClose={() => (!dirty || confirm('Закрыть без сохранения плана?')) && onClose()}
      title={doc ? (edit ? 'План' : doc.title) : 'План'}
      actions={
        doc &&
        !edit && (
          <Button size="sm" variant="ghost" onClick={() => setEdit({ title: doc.title, content: doc.content ?? '' })}>
            Изменить
          </Button>
        )
      }
      footer={
        doc && (
          <>
            <span className={styles.byline}>
              {doc.author} · изменён {timeAgo(doc.updatedAt)} · rev {doc.rev}
            </span>
            <span className="grow" />
            {edit && (
              <>
                <Button variant="ghost" onClick={() => setEdit(null)} disabled={busy}>
                  Отмена
                </Button>
                <Button variant="primary" onClick={save} disabled={busy || !dirty || !edit.title.trim()}>
                  Сохранить
                </Button>
              </>
            )}
          </>
        )
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      {!doc && !error && <p className={styles.muted}>Загружаю…</p>}
      {doc && edit && (
        <div className={styles.body}>
          <Input
            value={edit.title}
            onChange={(e) => setEdit({ ...edit, title: e.target.value })}
            maxLength={300}
            aria-label="Название плана"
          />
          <Textarea
            mono
            rows={22}
            value={edit.content}
            onChange={(e) => setEdit({ ...edit, content: e.target.value })}
            placeholder="Markdown"
          />
        </div>
      )}
      {doc && !edit && <Markdown source={doc.content ?? ''} />}
    </Modal>
  );
}
