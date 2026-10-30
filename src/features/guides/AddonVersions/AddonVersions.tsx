import { Check, ChevronDown, ChevronRight, Copy, History, Pencil, Tag } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  addonVersionRevisions,
  addonVersionsEnabled,
  saveAddonVersion,
  subscribeAddonVersions,
  type AddonVersionEdit,
} from '@/data/addonVersions';
import type { Addon } from '@/lib/addons';
import {
  STATUS_LABEL,
  STATUS_TITLE,
  latestReleased,
  type AddonVersion,
  type AddonVersionRevision,
  type AddonVersionStatus,
} from '@tfc/core/addonVersions';
import { readNick } from '@/shared/lib/nick';
import { cx } from '@/shared/lib';
import type { GuideChecked } from '@/entities/guide';
import { Markdown } from '@/components/Markdown';
import { MarkdownField } from '@/components/MarkdownField';
import { Button, Card, EmptyState, Modal, contentStyles as content } from '@/shared/ui';
import { CHECKED } from '../guideMeta';
import { CheckedBadge } from '../GuidesSection';
import guideStyles from '../Guides.module.css';
import styles from './AddonVersions.module.css';

/** Сколько последних версий развёрнуто сразу */
const OPEN = 3;

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} КБ` : `${(n / 1024 / 1024).toFixed(1)} МБ`);
const dateRu = (d: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d)
    ? new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
    : d;

/**
 * Версии аддона (Firestore addonVersions): у каждой свой ченджлог «что изменилось с прошлой», статус и «что
 * проверено». Правят все игроки, каждая правка — в истории. jar версий — на сервере сборки: ставит `tfc pull addons
 * <мод>@<версия>`, с сайта без ключа скачивается только последняя (кнопка в шапке аддона).
 */
export default function AddonVersions({ addon }: { addon: Addon }) {
  const [list, setList] = useState<AddonVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  // Другой аддон — новый компонент (key в AddonPage), поэтому список заново не обнуляем
  useEffect(() => subscribeAddonVersions(addon.id, setList, (e) => setError(e.message)), [addon.id]);

  if (!addonVersionsEnabled) return null;
  const latest = list ? latestReleased(list) : null;
  const shown = list && !all ? list.slice(0, OPEN) : list;
  return (
    <Card className={styles.addonVersions}>
      <h2 className={cx(content.heading, styles.heading)}>
        <Tag size={18} /> Версии
      </h2>
      {error ? (
        <div className={cx(guideStyles.guideErrors, 'small')}>Не удалось загрузить версии: {error}</div>
      ) : !list ? (
        <EmptyState>Загружаю версии…</EmptyState>
      ) : !list.length ? (
        <EmptyState>Версий пока нет — они появляются при выпуске аддона</EmptyState>
      ) : (
        <>
          <p className="faint small">
            Поставить другую версию (например, откатиться, если новая сломалась):{' '}
            <code>tfc pull addons {addon.id}@&lt;версия&gt;</code> — программа запомнит её и не обновит сама; вернуть
            последнюю — <code>tfc pull addons {addon.id}@latest</code>. Ченджлог и «что проверено» правят все игроки.
          </p>
          <ul className={styles.addonVersionsList}>
            {shown!.map((v) => (
              <VersionRow key={v.id} addon={addon} v={v} latest={latest?.id === v.id} />
            ))}
          </ul>
          {list.length > OPEN && (
            <Button variant="ghost" className="small" onClick={() => setAll(!all)}>
              {all ? 'Свернуть' : `Ещё ${list.length - OPEN}`}
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

function StatusBadge({ s }: { s: AddonVersionStatus }) {
  return (
    <span className={cx(guideStyles.guideBadge, styles.addonStatus)} data-status={s} title={STATUS_TITLE[s]}>
      {STATUS_LABEL[s]}
    </span>
  );
}

function VersionRow({ addon, v, latest }: { addon: Addon; v: AddonVersion; latest: boolean }) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState<AddonVersionEdit | null>(null);
  const [history, setHistory] = useState(false);
  const [copied, setCopied] = useState(false);
  const cmd = `tfc pull addons ${addon.id}@${v.version}`;

  const startEdit = (from?: AddonVersionEdit) => {
    if (!readNick()) {
      alert('Сначала укажите ник (вверху справа) — им подписываются правки');
      return;
    }
    setEditing(
      from ?? {
        changelog: v.changelog,
        status: v.status,
        checked: v.checked,
        checkedNote: v.checkedNote,
        date: v.date,
      },
    );
  };

  return (
    <li className={cx(styles.addonVersion, v.status === 'withdrawn' && styles.withdrawn)}>
      <div className={styles.addonVersionHead}>
        <Button
          variant="ghost"
          icon
          className="small"
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Свернуть' : 'Развернуть'}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </Button>
        <b className={styles.addonVersionNum}>{v.version}</b>
        <span className="faint small">{dateRu(v.date)}</span>
        <StatusBadge s={v.status} />
        {latest && <span className={cx(guideStyles.guideBadge, styles.addonStatusLatest)}>последняя</span>}
        <CheckedBadge c={v.checked} />
        <span className="grow" />
        {v.jar && <span className="faint small">{kb(v.jar.size)}</span>}
        <Button variant="ghost" className="small" onClick={() => setHistory(true)} title="Прошлые правки">
          <History size={14} />
        </Button>
        <Button variant="ghost" className="small" onClick={() => startEdit()} title="Править ченджлог и статус">
          <Pencil size={14} />
        </Button>
      </div>
      {open && !editing && (
        <div className={styles.addonVersionBody}>
          {v.changelog.trim() ? (
            <Markdown source={v.changelog} />
          ) : (
            <div className="faint small">Ченджлога нет — допишите, что изменилось (кнопка «Править»)</div>
          )}
          {v.checkedNote && <p className="faint small">Проверка: {v.checkedNote}</p>}
          {v.jar ? (
            <p className={cx('faint small', styles.addonVersionCmd)}>
              <code>{cmd}</code>
              <Button
                variant="ghost"
                icon
                className="small"
                title="Скопировать команду"
                onClick={() =>
                  navigator.clipboard.writeText(cmd).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  })
                }
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </Button>
              {v.status === 'withdrawn' && <span> — отозвана: ставьте, только если знаете зачем</span>}
            </p>
          ) : (
            <p className="faint small">jar этой версии на сервер сборки не залит — поставить её программой нельзя</p>
          )}
          <p className="faint small">
            правил {v.updatedBy}, {new Date(v.updatedAt).toLocaleDateString('ru-RU')}
          </p>
        </div>
      )}
      {editing && <VersionEditor v={v} edit={editing} onClose={() => setEditing(null)} />}
      {history && (
        <VersionHistory
          v={v}
          onClose={() => setHistory(false)}
          onRestore={(r) => {
            setHistory(false);
            startEdit({
              changelog: r.changelog,
              status: r.status,
              checked: r.checked,
              checkedNote: r.checkedNote,
              date: r.date,
            });
          }}
        />
      )}
    </li>
  );
}

function VersionEditor({ v, edit, onClose }: { v: AddonVersion; edit: AddonVersionEdit; onClose: () => void }) {
  const [d, setD] = useState(edit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof AddonVersionEdit>(k: K, val: AddonVersionEdit[K]) => setD((x) => ({ ...x, [k]: val }));
  const save = async () => {
    const nick = readNick();
    if (!nick) return;
    setBusy(true);
    setError(null);
    try {
      await saveAddonVersion(v, d, nick);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className={styles.addonVersionEdit}>
      <div className={styles.addonVersionFields}>
        <label>
          <span className="small">Дата</span>
          <input type="date" value={d.date} onChange={(e) => set('date', e.target.value)} />
        </label>
        <label>
          <span className="small">Статус</span>
          <select value={d.status} onChange={(e) => set('status', e.target.value as AddonVersionStatus)}>
            {(Object.keys(STATUS_LABEL) as AddonVersionStatus[]).map((s) => (
              <option key={s} value={s} title={STATUS_TITLE[s]}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="small">Проверено</span>
          <select value={d.checked} onChange={(e) => set('checked', e.target.value as GuideChecked)}>
            {(Object.keys(CHECKED) as GuideChecked[]).map((c) => (
              <option key={c} value={c}>
                {CHECKED[c].label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className={styles.addonVersionNote}>
        <span className="small">Как проверяли, что не проверено</span>
        <input value={d.checkedNote} maxLength={2000} onChange={(e) => set('checkedNote', e.target.value)} />
      </label>
      <span className="small">Что изменилось с прошлой версии — для игроков</span>
      <MarkdownField
        value={d.changelog}
        onChange={(t) => set('changelog', t)}
        rows={6}
        placeholder={'- Новый блок …\n- Исправлено …\n- Важно: …'}
      />
      {d.status === 'withdrawn' && v.status !== 'withdrawn' && (
        <p className={cx('small', guideStyles.guideErrors)}>
          Отозванную версию tfc pull не ставит, а у кого она стоит — откатит на прошлую выпущенную. Напишите в
          ченджлоге, что сломано.
        </p>
      )}
      {error && <div className={cx(guideStyles.guideErrors, 'small')}>Не сохранилось: {error}</div>}
      <div className={styles.addonVersionActions}>
        <Button className="small" disabled={busy || d.changelog.length > 20000} onClick={save}>
          {busy ? 'Сохраняю…' : 'Сохранить'}
        </Button>
        <Button variant="ghost" className="small" disabled={busy} onClick={onClose}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

function VersionHistory({
  v,
  onClose,
  onRestore,
}: {
  v: AddonVersion;
  onClose: () => void;
  onRestore: (r: AddonVersionRevision) => void;
}) {
  const [list, setList] = useState<AddonVersionRevision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  useEffect(() => {
    addonVersionRevisions(v.id)
      .then(setList)
      .catch((e) => setError(e.message));
  }, [v.id]);
  const r = list?.[pick];
  return (
    <Modal title={`История: ${v.addon} ${v.version}`} onClose={onClose} wide>
      {error ? (
        <div className={cx(guideStyles.guideErrors, 'small')}>{error}</div>
      ) : !list ? (
        <EmptyState>Загружаю…</EmptyState>
      ) : !list.length ? (
        <EmptyState>Правок с сайта ещё не было</EmptyState>
      ) : (
        <div className={guideStyles.guideHistory}>
          <ul className={guideStyles.guideHistoryList}>
            {list.map((x, i) => (
              <li key={x.id}>
                <button
                  className={cx(guideStyles.guideHistoryItem, i === pick && guideStyles.active)}
                  onClick={() => setPick(i)}
                >
                  <b>{new Date(x.at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</b>
                  <span className="faint small">
                    {x.updatedBy}
                    {i === 0 ? ' · сейчас' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {r && (
            <div className={guideStyles.guideHistoryView}>
              {pick > 0 && (
                <Button className="small" onClick={() => onRestore(r)}>
                  Вернуть эту версию…
                </Button>
              )}
              <p className="small">
                <StatusBadge s={r.status} /> <CheckedBadge c={r.checked} /> {dateRu(r.date)}
              </p>
              <Markdown source={r.changelog || '(пусто)'} />
              {r.checkedNote && <p className="faint small">Проверка: {r.checkedNote}</p>}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
