import { FilePen, FilePlus2, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PackSection } from '@/shared/ui';
import { Member, TagEditor } from '../components/TagEditor';
import { useData } from '../data/DataContext';
import { datapacksStore } from '@/entities/datapack';
import { useSearchTrack } from '@/shared/api';
import {
  useItems,
  directMembers,
  flattenTag,
  kindsOf,
  searchTags,
  sourceName,
  TAG_KIND_LABEL,
  TAG_KINDS,
  tagKey,
  tagPath,
  useTags,
  type Tag,
  type TagKind,
} from '@/shared/pack-data';
import { cx, uid } from '@/shared/lib';
import type { Datapack, DatapackEntry } from '../types';
import { PackPicker, type Pending } from '@/pages/recipes';
import './TagsPage.css';

const SHOWN = 120;

/** Теги сборки: поиск по id и по составу, откуда что взялось, правка датапаком */
export function TagsPage() {
  const cat = useTags();
  const items = useItems();
  const navigate = useNavigate();
  const { nick } = useData();
  const [params, setParams] = useSearchParams();
  const kind = (params.get('kind') as TagKind | 'all' | null) ?? 'all';
  const selectedKey = params.get('tag');
  const packId = params.get('pack');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [editing, setEditing] = useState<{ kind: TagKind; id: string | null } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [packs, setPacks] = useState<Datapack[]>([]);
  const [all, setAll] = useState(false);

  useEffect(() => datapacksStore.subscribe(setPacks), []);
  const pack = packs.find((p) => p.id === packId) ?? null;

  const found = useMemo(() => (cat ? searchTags(cat, items, q, kind) : []), [cat, items, q, kind]);
  useSearchTrack('tags', q, cat ? found.length : undefined);
  const tag = selectedKey && cat ? cat.byKey.get(selectedKey) : undefined;

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  // Файл этого тега, если он уже лежит в выбранном датапаке (его и правим)
  const existingEntry: DatapackEntry | undefined =
    pack && editing?.id ? pack.entries.find((e) => e.path === tagPath(editing.kind, editing.id!)) : undefined;

  const save = (r: { path: string; content: string; kind: TagKind; id: string }) => {
    const make = (p: Pick<Datapack, 'namespace' | 'entries'>): DatapackEntry => {
      const prev = p.entries.find((e) => e.path === r.path);
      return {
        id: prev?.id ?? uid(),
        kind: 'file',
        path: r.path,
        content: r.content,
        note: `тег ${TAG_KIND_LABEL[r.kind].toLowerCase()} #${r.id}`,
      };
    };
    setEditing(null);
    if (pack) {
      const entry = make(pack);
      datapacksStore
        .update(pack.id, { entries: [...pack.entries.filter((e) => e.path !== entry.path), entry], updatedBy: nick })
        .then(() => navigate(`/datapacks?pack=${pack.id}`));
    } else setPending(() => make);
  };

  const shown = all ? found : found.slice(0, SHOWN);

  return (
    <PackSection>
      <main className="tags-page">
        <div className="tags-head">
          <div className="grow">
            <h1>Теги сборки</h1>
            <p className="faint small">
              Состав каждого тега по модам и скриптам KubeJS. Поиск идёт по id тега и по тому, что в него входит
              (по-русски тоже). Править можно датапаком: добавить, убрать, заменить состав.
            </p>
          </div>
          <button className="btn" onClick={() => setEditing({ kind: kind === 'all' ? 'item' : kind, id: null })}>
            <FilePlus2 size={15} /> Новый тег
          </button>
        </div>

        {pack && (
          <p className="tags-pack small">
            Правка пойдёт в датапак <b>{pack.name}</b>.{' '}
            <button className="link" onClick={() => set({ pack: null })}>
              Выбирать при сохранении
            </button>
          </p>
        )}

        <div className="tags-bar">
          <div className="tags-search">
            <Search size={15} className="faint" />
            <input
              className="input"
              autoFocus
              value={q}
              placeholder="Тег или что в нём: plantoil, оливковое масло, ingots/steel…"
              onChange={(e) => {
                setQ(e.target.value);
                setAll(false);
              }}
            />
          </div>
          <span className="seg">
            <button aria-pressed={kind === 'all'} onClick={() => set({ kind: null })}>
              Все
            </button>
            {TAG_KINDS.map((k) => (
              <button key={k} aria-pressed={kind === k} onClick={() => set({ kind: k })}>
                {TAG_KIND_LABEL[k]}
              </button>
            ))}
          </span>
        </div>

        {!cat ? (
          <p className="faint">Загружаю теги…</p>
        ) : cat.list.length === 0 ? (
          <p className="empty">
            Тегов нет: пересоберите библиотеку (<code>npm run mods</code>) — она создаёт <code>public/tags.json</code>.
          </p>
        ) : (
          <div className="tags-body">
            <aside className="tags-list">
              <div className="faint small tags-count">
                Найдено {found.length}
                {found.length > shown.length && `, показано ${shown.length}`}
              </div>
              <ul>
                {shown.map((t) => (
                  <li key={t.key}>
                    <button className={cx(t.key === selectedKey && 'active')} onClick={() => set({ tag: t.key })}>
                      <code>{t.i}</code>
                      <span className="faint small">
                        <KindLabel kind={t.k} /> {directMembers(t).length}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {found.length > shown.length && (
                <button className="btn ghost sm" onClick={() => setAll(true)}>
                  Показать все {found.length}
                </button>
              )}
            </aside>

            <section className="tags-detail">
              {tag ? (
                <TagDetail
                  key={tag.key}
                  tag={tag}
                  onEdit={() => setEditing({ kind: tag.k, id: tag.i })}
                  hasEntry={Boolean(pack?.entries.some((e) => e.path === tagPath(tag.k, tag.i)))}
                  onOpenTag={(id, k = tag.k) => set({ tag: tagKey(k, id) })}
                />
              ) : (
                <div className="tags-hint faint">
                  Выберите тег слева. Например <code>c:plantoil</code> — масла для биодизеля, или найдите тег по
                  предмету.
                </div>
              )}
            </section>
          </div>
        )}

        {editing && cat && (
          <TagEditor
            key={`${editing.kind}|${editing.id}`}
            cat={cat}
            kind={editing.kind}
            tagId={editing.id}
            existing={existingEntry?.content}
            saveLabel={pack ? `В датапак «${pack.name}»` : 'Выбрать датапак…'}
            onSave={save}
            onClose={() => setEditing(null)}
          />
        )}
        {pending && <PackPicker make={pending} onClose={() => setPending(null)} />}
      </main>
    </PackSection>
  );
}

function TagDetail({
  tag,
  onEdit,
  hasEntry,
  onOpenTag,
}: {
  tag: Tag;
  onEdit: () => void;
  hasEntry: boolean;
  onOpenTag: (id: string, kind?: TagKind) => void;
}) {
  const cat = useTags();
  const direct = useMemo(() => directMembers(tag), [tag]);
  const flat = useMemo(() => (cat ? flattenTag(cat, tag.k, direct) : direct), [cat, direct, tag.k]);
  const nested = direct.filter((m) => m.startsWith('#'));
  const [full, setFull] = useState(false);
  const list = full ? direct : direct.slice(0, 150);
  const regex = tag.ops.flatMap((o) => o.re ?? []);
  const others = cat ? kindsOf(cat, tag.i).filter((k) => k !== tag.k) : [];

  return (
    <div className="tag-detail">
      <div className="tag-detail-head">
        <div className="grow">
          <h2>
            <code>#{tag.i}</code>
          </h2>
          <p className="faint small">
            <KindLabel kind={tag.k} /> в составе {direct.length}
            {nested.length > 0 && `, с вложенными тегами ${flat.length}`} · источников {tag.s.length + tag.ops.length}
          </p>
        </div>
        <button className="btn primary" onClick={onEdit}>
          <FilePen size={15} /> {hasEntry ? 'Править файл в датапаке' : 'Править датапаком'}
        </button>
      </div>

      {others.length > 0 ? (
        <p className="tag-kind-note small">
          Тег с таким же именем есть и у вида{' '}
          {others.map((k) => (
            <button key={k} className="link" onClick={() => onOpenTag(tag.i, k)}>
              <KindLabel kind={k} />
            </button>
          ))}{' '}
          — это разные теги со своим составом.
        </p>
      ) : (
        tag.k !== 'item' &&
        tag.k !== 'fluid' && (
          <p className="tag-kind-note small">
            Это тег вида «{TAG_KIND_LABEL[tag.k]}»: в рецептах (<code>"tag": "{tag.i}"</code>) он не сработает — рецепты
            берут теги предметов и жидкостей.
          </p>
        )
      )}

      <h3>Откуда берётся</h3>
      <ol className="tag-sources">
        {tag.s.map((s, n) => (
          <li key={n}>
            <b>{sourceName(s.s)}</b>
            <span className="faint small">
              {s.r ? ' · заменяет всё до этого' : ''}
              {s.v.length ? ` · +${s.v.length}` : ''}
              {s.x?.length ? ` · −${s.x.length}` : ''}
            </span>
            <span className="tag-source-ids small">
              {s.v.slice(0, 6).map((v) => (
                <code key={v}>{v}</code>
              ))}
              {s.v.length > 6 && <span className="faint">и ещё {s.v.length - 6}</span>}
              {s.x?.map((v) => (
                <code key={v} className="neg">
                  −{v}
                </code>
              ))}
            </span>
          </li>
        ))}
        {tag.ops.map((o, n) => (
          <li key={`k${n}`}>
            <b>KubeJS</b>
            <span className="faint small">
              {' '}
              · {o.op === 'add' ? 'добавляет' : o.op === 'remove' ? 'убирает' : 'очищает'} ·{' '}
              <code>
                {o.file}:{o.line}
              </code>
            </span>
            <span className="tag-source-ids small">
              {o.v.slice(0, 6).map((v) => (
                <code key={v} className={cx(o.op === 'remove' && 'neg')}>
                  {o.op === 'remove' ? '−' : ''}
                  {v}
                </code>
              ))}
              {o.v.length > 6 && <span className="faint">и ещё {o.v.length - 6}</span>}
              {o.re?.map((r) => (
                <code key={r}>шаблон {r}</code>
              ))}
            </span>
          </li>
        ))}
        {tag.s.length + tag.ops.length === 0 && <li className="faint">Нигде не определён.</li>}
      </ol>
      {regex.length > 0 && (
        <p className="faint small">
          Шаблоны KubeJS ({regex.join(', ')}) раскрываются по реестру игры — здесь их состав не показан.
        </p>
      )}

      <h3>Состав сейчас</h3>
      <ul className="tag-members">
        {list.map((m) => (
          <li key={m}>
            {m.startsWith('#') ? (
              <button className="link" onClick={() => onOpenTag(m.slice(1))}>
                <Member cat={cat} kind={tag.k} id={m} />
              </button>
            ) : (
              <Member cat={cat} kind={tag.k} id={m} />
            )}
          </li>
        ))}
      </ul>
      {direct.length > list.length && (
        <button className="btn ghost sm" onClick={() => setFull(true)}>
          Показать все {direct.length}
        </button>
      )}
    </div>
  );
}

/** Ярлык вида тега: предметы, блоки, жидкости, сущности — своим цветом */
function KindLabel({ kind }: { kind: TagKind }) {
  return <span className={`tag-kind tag-kind-${kind}`}>{TAG_KIND_LABEL[kind]}</span>;
}
