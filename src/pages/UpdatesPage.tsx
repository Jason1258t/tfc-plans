import { AlertTriangle, ChevronDown, ChevronRight, Package, Pencil, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ItemIcon } from '../components/ItemIcon';
import { Markdown } from '../components/Markdown';
import { useData } from '../data/DataContext';
import { datapacksStore } from '../data/store';
import { generatePatchNotes, geminiEnabled, geminiErrorText } from '../lib/gemini';
import { useItems, type ItemIndex } from '../lib/items';
import {
  datapackRisks,
  markUpdatesSeen,
  nsOf,
  saveNotes,
  usePackUpdates,
  type DatapackRisk,
  type ModRef,
  type PackUpdate,
} from '../lib/packUpdates';
import { cx, timeAgo } from '../lib/util';
import type { Datapack } from '../types';
import './UpdatesPage.css';

/** Лента обновлений сборки: патчноут от модели + машинная разница (моды, предметы, рецепты, датапаки) */
export function UpdatesPage() {
  const updates = usePackUpdates();
  const items = useItems();
  const [packs, setPacks] = useState<Datapack[]>([]);
  useEffect(() => datapacksStore.subscribe(setPacks), []);

  useEffect(() => {
    if (updates?.length) markUpdatesSeen(updates[0].createdAt);
  }, [updates]);

  return (
    <main className="upd-page">
      <div className="upd-head">
        <h1>Обновления сборки</h1>
        <p className="faint small">
          Запись появляется при деплое, если поменялись jar в mods/. Патчноут пишет модель по ченджлогам модов с
          Modrinth и разнице сборок; его можно поправить руками.
        </p>
      </div>
      {updates === null ? (
        <div className="empty">Загружаю…</div>
      ) : updates.length === 0 ? (
        <div className="empty">
          Записей пока нет — первая появится при следующем деплое (<code>npm run deploy</code>).
        </div>
      ) : (
        updates.map((u, i) => <UpdateCard key={u.id} update={u} items={items} packs={packs} latest={i === 0} />)
      )}
    </main>
  );
}

function UpdateCard({
  update: u,
  items,
  packs,
  latest,
}: {
  update: PackUpdate;
  items: ItemIndex | null;
  packs: Datapack[];
  latest: boolean;
}) {
  const { nick, groups, tasks } = useData();
  const risks = useMemo(() => datapackRisks(u, packs), [u, packs]);
  const [open, setOpen] = useState(latest);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const autoTried = useRef(false);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const active = tasks.filter((t) => t.status !== 'done');
      const context =
        `Группы задач: ${groups.map((g) => g.name).join(', ') || 'нет'}.\n` +
        `Активные задачи: ${active
          .slice(0, 40)
          .map((t) => t.title)
          .join('; ')}`;
      const body = await generatePatchNotes({ report: describeUpdate(u, items, risks), context });
      await saveNotes(u.id, body, 'agent', nick);
    } catch (e) {
      setError(geminiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  // Патчноут для свежего обновления пишется сам при первом открытии — дальше его видят все
  useEffect(() => {
    if (!latest || u.baseline || u.notes || !geminiEnabled || !items || autoTried.current) return;
    autoTried.current = true;
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest, u.baseline, u.notes, items]);

  const m = u.mods;
  return (
    <article className={cx('upd-card', latest && 'latest')}>
      <header className="upd-card-head">
        <Package size={18} className="faint" />
        <div className="grow">
          <h2>
            {u.baseline ? 'Начало истории' : `Обновление от ${new Date(u.createdAt).toLocaleDateString('ru-RU')}`}
          </h2>
          <div className="faint small">
            {timeAgo(u.createdAt)} · {u.deployedBy} · модов {u.counts.mods[1]}, предметов{' '}
            {u.counts.items[1].toLocaleString('ru-RU')}, рецептов {u.counts.recipes[1].toLocaleString('ru-RU')}
          </div>
        </div>
        {!u.baseline && (
          <div className="upd-badges">
            {m.added.length > 0 && <span className="tag add">+{m.added.length} мод.</span>}
            {m.updated.length > 0 && <span className="tag upd">~{m.updated.length}</span>}
            {m.removed.length > 0 && <span className="tag del">−{m.removed.length}</span>}
            {risks.length > 0 && (
              <span className="tag warn">
                <AlertTriangle size={12} /> датапаки
              </span>
            )}
          </div>
        )}
      </header>

      {!u.baseline && (
        <section className="upd-notes">
          {editing ? (
            <>
              <textarea
                className="input upd-notes-edit"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={14}
                autoFocus
              />
              <div className="row upd-notes-actions">
                <button className="btn ghost sm" onClick={() => setEditing(false)}>
                  Отмена
                </button>
                <button
                  className="btn primary sm"
                  onClick={async () => {
                    await saveNotes(u.id, draft, 'manual', nick);
                    setEditing(false);
                  }}
                >
                  Сохранить
                </button>
              </div>
            </>
          ) : u.notes ? (
            <>
              <Markdown source={u.notes.body} />
              <div className="row faint small upd-notes-meta">
                <span className="grow">
                  {u.notes.source === 'agent' ? 'Патчноут от модели' : 'Патчноут поправлен вручную'} ·{' '}
                  {u.notes.updatedBy} · {timeAgo(u.notes.updatedAt)}
                </span>
                <button
                  className="btn ghost sm"
                  onClick={() => {
                    setDraft(u.notes!.body);
                    setEditing(true);
                  }}
                >
                  <Pencil size={13} /> Править
                </button>
                {geminiEnabled && (
                  <button className="btn ai sm" onClick={generate} disabled={busy}>
                    <Sparkles size={13} /> {busy ? 'Пишу…' : 'Обновить агентом'}
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="row upd-notes-empty">
              <span className="faint grow">{busy ? 'Модель пишет патчноут…' : 'Патчноута пока нет.'}</span>
              {geminiEnabled && !busy && (
                <button className="btn ai sm" onClick={generate}>
                  <Sparkles size={13} /> Составить агентом
                </button>
              )}
              <button
                className="btn ghost sm"
                onClick={() => {
                  setDraft('');
                  setEditing(true);
                }}
              >
                <Pencil size={13} /> Написать
              </button>
            </div>
          )}
          {error && <div className="error-box">{error}</div>}
        </section>
      )}

      {risks.length > 0 && <Risks risks={risks} />}

      <button className="btn ghost sm upd-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {u.baseline ? 'Состав сборки' : 'Что изменилось'}
      </button>
      {open && <Details u={u} />}
    </article>
  );
}

function Risks({ risks }: { risks: DatapackRisk[] }) {
  return (
    <section className="upd-risks">
      <h3>
        <AlertTriangle size={14} /> Датапаки под угрозой
      </h3>
      <ul>
        {risks.map((r, i) => (
          <li key={i}>
            <Link to={`/datapacks?pack=${r.pack.id}`}>{r.pack.name}</Link> · <code>{r.path}</code> — {r.reason}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ModList({ title, mods, changelogs }: { title: string; mods: ModRef[]; changelogs?: Record<string, string> }) {
  if (!mods.length) return null;
  return (
    <div className="upd-block">
      <h4>
        {title} <span className="faint">{mods.length}</span>
      </h4>
      <ul className="upd-mods">
        {mods.map((m) => (
          <li key={m.id}>
            {changelogs?.[m.id] ? (
              <details>
                <summary>
                  <ModLine m={m} /> <span className="faint small">ченджлог</span>
                </summary>
                <div className="upd-changelog">
                  <Markdown source={changelogs[m.id]} />
                </div>
              </details>
            ) : (
              <ModLine m={m} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const ModLine = ({ m }: { m: ModRef }) => (
  <span>
    <b>{m.name}</b>{' '}
    <span className="faint small">
      {m.from ? `${m.from} → ${m.version}` : m.version} · <code>{m.id}</code>
    </span>
  </span>
);

/** Предметы по модам: иконки, первые 48 в группе */
function ItemGroups({ ids, total }: { ids: string[]; total: number }) {
  const groups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const id of ids) map.set(nsOf(id), [...(map.get(nsOf(id)) ?? []), id]);
    return [...map].sort((a, b) => b[1].length - a[1].length);
  }, [ids]);
  return (
    <div className="upd-items">
      {groups.map(([ns, list]) => (
        <div key={ns} className="upd-item-group">
          <div className="faint small">
            <code>{ns}</code> · {list.length}
          </div>
          <div className="upd-icons">
            {list.slice(0, 48).map((id) => (
              <ItemIcon key={id} id={id} size={24} />
            ))}
            {list.length > 48 && <span className="faint small">ещё {list.length - 48}</span>}
          </div>
        </div>
      ))}
      {total > ids.length && (
        <div className="faint small">
          Показаны первые {ids.length} из {total}.
        </div>
      )}
    </div>
  );
}

function RecipeCounts({ title, ids, total }: { title: string; ids: string[]; total: number }) {
  if (!total) return null;
  const byNs = new Map<string, number>();
  for (const id of ids) byNs.set(nsOf(id), (byNs.get(nsOf(id)) ?? 0) + 1);
  return (
    <details className="upd-block">
      <summary>
        <b>{title}</b> <span className="faint">{total.toLocaleString('ru-RU')}</span>{' '}
        <span className="faint small">
          {[...byNs]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([ns, n]) => `${ns} ${n}`)
            .join(', ')}
        </span>
      </summary>
      <ul className="upd-recipes">
        {ids.slice(0, 300).map((id) => (
          <li key={id}>
            <code>{id}</code>
          </li>
        ))}
        {ids.length > 300 && <li className="faint">… ещё {ids.length - 300}</li>}
      </ul>
    </details>
  );
}

function Details({ u }: { u: PackUpdate }) {
  if (u.baseline)
    return (
      <div className="upd-details">
        <ModList title="Моды" mods={[...u.mods.added].sort((a, b) => a.name.localeCompare(b.name))} />
      </div>
    );
  const t = u.totals;
  return (
    <div className="upd-details">
      <ModList title="Новые моды" mods={u.mods.added} changelogs={u.changelogs} />
      <ModList title="Обновлённые" mods={u.mods.updated} changelogs={u.changelogs} />
      <ModList title="Убранные" mods={u.mods.removed} />
      {!!t?.itemsAdded && (
        <div className="upd-block">
          <h4>
            Новые предметы <span className="faint">{t.itemsAdded}</span>
          </h4>
          <ItemGroups ids={u.items?.added ?? []} total={t.itemsAdded} />
        </div>
      )}
      {!!t?.itemsRemoved && (
        <div className="upd-block">
          <h4>
            Пропавшие предметы <span className="faint">{t.itemsRemoved}</span>
          </h4>
          <ul className="upd-recipes">
            {(u.items?.removed ?? []).slice(0, 200).map((id) => (
              <li key={id}>
                <code>{id}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      <RecipeCounts title="Новые рецепты" ids={u.recipes?.added ?? []} total={t?.recipesAdded ?? 0} />
      <RecipeCounts title="Изменённые рецепты" ids={u.recipes?.changed ?? []} total={t?.recipesChanged ?? 0} />
      <RecipeCounts title="Удалённые рецепты" ids={u.recipes?.removed ?? []} total={t?.recipesRemoved ?? 0} />
      {!!u.newRecipeTypes?.length && (
        <div className="upd-block">
          <h4>Новые типы рецептов</h4>
          <p className="faint small">
            Подсказки для них можно составить агентом в редакторе датапака (рецепт по шаблону этого типа).
          </p>
          <div className="upd-types">
            {u.newRecipeTypes.map((t) => (
              <code key={t}>{t}</code>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Текстовый отчёт для модели: всё, на что ей можно опираться */
function describeUpdate(u: PackUpdate, items: ItemIndex | null, risks: DatapackRisk[]): string {
  const name = (id: string) => {
    const it = items?.byId.get(id);
    return it ? `${it.r ?? it.e} (${id})` : id;
  };
  const lines: string[] = [];
  const mods = (title: string, list: ModRef[]) => {
    if (!list.length) return;
    lines.push(`## ${title}`);
    for (const m of list) lines.push(`- ${m.name} [${m.id}] ${m.from ? `${m.from} → ${m.version}` : m.version}`);
  };
  mods('Новые моды', u.mods.added);
  mods('Обновлённые моды', u.mods.updated);
  mods('Убранные моды', u.mods.removed);
  const t = u.totals;
  lines.push(
    `## Счётчики\nпредметы +${t?.itemsAdded ?? 0} −${t?.itemsRemoved ?? 0}; рецепты +${t?.recipesAdded ?? 0} ` +
      `−${t?.recipesRemoved ?? 0}, изменено ${t?.recipesChanged ?? 0}. Всего: модов ${u.counts.mods.join(' → ')}, ` +
      `предметов ${u.counts.items.join(' → ')}, рецептов ${u.counts.recipes.join(' → ')}.`,
  );
  const sample = (title: string, ids: string[]) => {
    if (!ids.length) return;
    const byNs = new Map<string, string[]>();
    for (const id of ids) byNs.set(nsOf(id), [...(byNs.get(nsOf(id)) ?? []), id]);
    lines.push(`## ${title} (примеры по модам)`);
    for (const [ns, list] of byNs)
      lines.push(`- ${ns} (${list.length}): ${list.slice(0, 30).map(name).join(', ')}${list.length > 30 ? ', …' : ''}`);
  };
  sample('Новые предметы', u.items?.added ?? []);
  sample('Пропавшие предметы', u.items?.removed ?? []);
  sample('Изменённые рецепты', u.recipes?.changed ?? []);
  if (u.newRecipeTypes?.length) lines.push(`## Новые типы рецептов\n${u.newRecipeTypes.join(', ')}`);
  if (risks.length)
    lines.push(
      `## Наши датапаки под угрозой\n${risks.map((r) => `- «${r.pack.name}» ${r.path}: ${r.reason}`).join('\n')}`,
    );
  const logs = Object.entries(u.changelogs ?? {});
  if (logs.length) {
    lines.push('## Ченджлоги модов (Modrinth)');
    for (const [id, text] of logs) lines.push(`### ${id}\n${text}`);
  } else lines.push('## Ченджлоги\nнет (моды не найдены на Modrinth)');
  return lines.join('\n');
}
