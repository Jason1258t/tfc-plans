import { parseRef } from '@tfc/pack-server/dev-refs';
import { Link2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNick } from '@/entities/user';
import { cx } from '@/shared/lib';
import { Button, ErrorBox, Input, Select } from '@/shared/ui';
import { devApi, type DevLink, type DevLinkEnd } from '../../model/api';
import { refClick, refHref } from '../DevMarkdown';
import styles from './DevLinks.module.css';

const KIND_LABEL: Record<DevLink['kind'], string> = { mention: 'упоминает', related: 'связано с', blocks: 'блокирует' };

/** Цели, которых нет на сервере: для пометки в тексте */
export const brokenRefs = (links: DevLink[]) => new Set(links.filter((l) => l.target.broken).map((l) => l.target.ref));

function End({ end, onOpen, showLabel }: { end: DevLinkEnd; onOpen: (ref: string) => void; showLabel?: boolean }) {
  return (
    <span className={styles.end}>
      <a
        className={cx(styles.ref, end.broken && styles.broken)}
        href={refHref(end.ref)}
        title={end.note ?? (end.broken ? 'Такого нет: ссылка битая' : undefined)}
        onClick={refClick(end.ref, onOpen)}
      >
        {end.ref}
      </a>
      {showLabel && end.label && <span className={styles.label}> {end.label}</span>}
      {end.removed && <span className={styles.label}> (пункт удалён)</span>}
    </span>
  );
}

/** Блок «Связи» окна задачи: упоминания из текстов и явные связи, которые можно добавить и снять */
export function DevLinks({
  taskId,
  links,
  onOpenRef,
  onChanged,
}: {
  taskId: number;
  links: DevLink[];
  onOpenRef: (ref: string) => void;
  onChanged: () => Promise<void>;
}) {
  const nick = useNick();
  const [to, setTo] = useState('');
  const [kind, setKind] = useState<'related' | 'blocks'>('related');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await devApi.link(`#${taskId}`, to.trim(), kind, nick);
      setTo('');
    });
  };

  return (
    <section>
      <h3>Связи</h3>
      {error && <ErrorBox>{error}</ErrorBox>}
      {links.length ? (
        <ul className={styles.list}>
          {links.map((l) => (
            <li key={l.id}>
              <End end={l.source} onOpen={onOpenRef} />
              <span className={styles.kind}>{KIND_LABEL[l.kind]}</span>
              <End end={l.target} onOpen={onOpenRef} showLabel />
              {l.kind !== 'mention' && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon
                  aria-label={`Снять связь ${l.source.ref} и ${l.target.ref}`}
                  disabled={busy}
                  onClick={() => void run(() => devApi.unlink(l.source.ref, l.target.ref, l.kind))}
                >
                  <X size={14} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>Связей нет. Ссылки вида #175, #175.3, doc:12, note:881 в текстах появятся здесь.</p>
      )}
      <form className={styles.form} onSubmit={add}>
        <Select aria-label="Вид связи" value={kind} onChange={(e) => setKind(e.target.value as 'related' | 'blocks')}>
          <option value="related">Связано с</option>
          <option value="blocks">Блокирует</option>
        </Select>
        <Input
          aria-label="Ссылка"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="#175, #175.3, doc:12, note:881"
        />
        <Button size="sm" type="submit" disabled={busy || !parseRef(to)}>
          <Link2 size={14} /> Связать
        </Button>
      </form>
    </section>
  );
}
