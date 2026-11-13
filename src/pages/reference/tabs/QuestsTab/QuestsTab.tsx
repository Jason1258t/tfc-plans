import { Search as SearchIcon } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { Quest, QuestBook, QuestChapter, QuestRef, QuestReward, QuestTask } from '@tfc/core/ftbQuests';
import { cx } from '@/shared/lib';
import { Card, Search, SectionShell, Select } from '@/shared/ui';
import {
  directMembers,
  flattenTag,
  ItemIcon,
  itemName,
  tagKey,
  useItems,
  useTags,
  type ItemIndex,
  type TagCatalog,
} from '@/shared/pack-data';
import { questIndex, searchQuests, useQuestBook, type QuestHit } from './questBook';
import styles from './QuestsTab.module.css';

/**
 * Справочник → «Квесты»: книга квестов FTB Quests сборки — главы по группам, карта главы с зависимостями,
 * карточка квеста. Данные — public/quests.json (тексты на русском, где нет перевода — английский).
 */

/** Шаг сетки FTB Quests в пикселях и размер значка квеста размера 1 */
const UNIT = 46;
const NODE = 38;

interface Props {
  chapter: string | null;
  quest: string | null;
  query: string;
  onPlace: (p: { chapter?: string | null; quest?: string | null; query?: string }) => void;
}

export function QuestsTab({ chapter, quest, query, onPlace }: Props) {
  const book = useQuestBook();
  const items = useItems();
  const tags = useTags();
  const index = useMemo(() => (book ? questIndex(book) : null), [book]);

  if (book === undefined) return <div className="empty">Загружаю книгу квестов…</div>;
  if (book === null || !index)
    return <div className="empty">Книга квестов ещё не собрана — её выкладывает сервер сборки (npm run quests).</div>;

  const current = book.chapters.find((c) => c.filename === chapter || c.id === chapter) ?? book.chapters[0];
  const selected = quest ? index.get(quest) : undefined;
  const nameOf = (id: string) => (id.startsWith('#') ? id : itemName(items?.byId.get(id), id));
  const hits = query ? searchQuests(book, query, nameOf) : [];
  const ctx: Ctx = { items, tags, index, onPlace, nameOf };

  return (
    <SectionShell navLabel="Главы книги квестов" nav={<ChapterNav book={book} current={current} onPlace={onPlace} />}>
      <div className={styles.main}>
        <Search className={styles.search}>
          <SearchIcon size={16} aria-hidden />
          <input
            value={query}
            placeholder="Найти квест: название, описание или предмет"
            onChange={(e) => onPlace({ chapter: current?.filename, query: e.target.value })}
          />
        </Search>
        {query ? (
          <SearchResults hits={hits} ctx={ctx} />
        ) : current ? (
          <>
            <div className={styles.chapterHead}>
              {current.icon && <ItemIcon id={current.icon} size={32} />}
              <div>
                <h2>{current.title}</h2>
                <p className="faint small">
                  {current.quests.length} квестов
                  {current.subtitle ? ` · ${current.subtitle}` : ''}
                </p>
              </div>
            </div>
            <ChapterMap chapter={current} selected={selected?.quest.id ?? null} ctx={ctx} />
            {selected ? (
              <QuestCard hit={selected} ctx={ctx} />
            ) : (
              <p className="faint small">Нажмите на квест, чтобы прочитать описание и задачи.</p>
            )}
          </>
        ) : (
          <div className="empty">В книге нет глав.</div>
        )}
      </div>
    </SectionShell>
  );
}

interface Ctx {
  items: ItemIndex | null;
  tags: TagCatalog | null;
  index: Map<string, QuestHit>;
  onPlace: Props['onPlace'];
  nameOf: (id: string) => string;
}

function ChapterNav({
  book,
  current,
  onPlace,
}: {
  book: QuestBook;
  current?: QuestChapter;
  onPlace: Props['onPlace'];
}) {
  return (
    <>
      {/* На телефоне вместо длинного списка кнопок — выпадающий список */}
      <Select
        className={styles.navSelect}
        aria-label="Глава"
        value={current?.filename ?? ''}
        onChange={(e) => onPlace({ chapter: e.target.value, quest: null })}
      >
        {book.groups.map((g) => {
          const options = book.chapters
            .filter((c) => c.group === g.id)
            .map((c) => (
              <option key={c.id} value={c.filename}>
                {c.title} ({c.quests.length})
              </option>
            ));
          return g.title ? (
            <optgroup key={g.id} label={g.title}>
              {options}
            </optgroup>
          ) : (
            options
          );
        })}
      </Select>
      {book.groups.map((g) => {
        const chapters = book.chapters.filter((c) => c.group === g.id);
        if (!chapters.length) return null;
        return (
          <div key={g.id} className={styles.navGroup}>
            {g.title && <div className={styles.navGroupTitle}>{g.title}</div>}
            {chapters.map((c) => (
              <button
                key={c.id}
                aria-pressed={c.id === current?.id}
                onClick={() => onPlace({ chapter: c.filename, quest: null })}
              >
                <span className={styles.navChapter}>
                  {c.icon && <ItemIcon id={c.icon} size={18} tip={false} />}
                  <span>{c.title}</span>
                </span>
                <span className="faint small">{c.quests.length}</span>
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}

/** Иконка квеста: своя, первого предмета задачи или первого предмета тега */
function questIcon(q: Quest, tags: TagCatalog | null): string | undefined {
  if (q.icon) return q.icon;
  const ref = q.tasks.flatMap((t) => t.items ?? [])[0];
  return ref ? refIcon(ref, tags) : undefined;
}

function refIcon(ref: QuestRef, tags: TagCatalog | null): string | undefined {
  if (!ref.id.startsWith('#')) return ref.id;
  if (!tags) return undefined;
  const tag = tags.byKey.get(tagKey('item', ref.id.slice(1)));
  return tag ? flattenTag(tags, 'item', directMembers(tag))[0] : undefined;
}

const questTitle = (q: Quest, ctx: Ctx) => {
  if (q.title) return q.title;
  const first = q.tasks.flatMap((t) => t.items ?? [])[0];
  return first ? ctx.nameOf(first.id) : 'Без названия';
};

function ChapterMap({ chapter, selected, ctx }: { chapter: QuestChapter; selected: string | null; ctx: Ctx }) {
  const quests = chapter.quests;
  if (!quests.length) return <div className="empty">Глава пустая.</div>;
  const minX = Math.min(...quests.map((q) => q.x));
  const minY = Math.min(...quests.map((q) => q.y));
  const maxX = Math.max(...quests.map((q) => q.x));
  const maxY = Math.max(...quests.map((q) => q.y));
  const pad = UNIT;
  const px = (x: number) => (x - minX) * UNIT + pad;
  const py = (y: number) => (y - minY) * UNIT + pad;
  const width = (maxX - minX) * UNIT + pad * 2;
  const height = (maxY - minY) * UNIT + pad * 2;
  const byId = new Map(quests.map((q) => [q.id, q]));
  const related = new Set<string>();
  if (selected) {
    const s = byId.get(selected);
    s?.deps.forEach((d) => related.add(d));
    for (const q of quests) if (q.deps.includes(selected)) related.add(q.id);
  }

  return (
    <div className={styles.mapBox}>
      <div className={styles.map} style={{ width, height }}>
        <svg className={styles.lines} width={width} height={height} aria-hidden>
          {quests.flatMap((q) =>
            q.deps
              .map((d) => byId.get(d))
              .filter((d): d is Quest => !!d)
              .map((d) => (
                <line
                  key={`${d.id}-${q.id}`}
                  x1={px(d.x)}
                  y1={py(d.y)}
                  x2={px(q.x)}
                  y2={py(q.y)}
                  className={cx(selected && (q.id === selected || d.id === selected) && styles.lineActive)}
                />
              )),
          )}
        </svg>
        {quests.map((q) => {
          const size = NODE * (q.size ?? 1);
          const icon = questIcon(q, ctx.tags);
          return (
            <button
              key={q.id}
              className={cx(
                styles.node,
                q.shape === 'square' || q.shape === 'rsquare' ? styles.square : null,
                q.shape === 'diamond' ? styles.diamond : null,
                q.optional && styles.optional,
                q.invisible && styles.invisible,
                q.id === selected && styles.selected,
                related.has(q.id) && styles.related,
              )}
              style={{ left: px(q.x) - size / 2, top: py(q.y) - size / 2, width: size, height: size }}
              title={questTitle(q, ctx)}
              aria-label={questTitle(q, ctx)}
              aria-pressed={q.id === selected}
              onClick={() => ctx.onPlace({ chapter: chapter.filename, quest: q.id === selected ? null : q.id })}
            >
              {icon ? (
                <ItemIcon id={icon} size={Math.round(size * 0.62)} tip={false} />
              ) : (
                <span className={styles.nodeDot} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RefChip({ r, ctx }: { r: QuestRef; ctx: Ctx }) {
  const icon = refIcon(r, ctx.tags);
  const isTag = r.id.startsWith('#');
  const to = isTag
    ? `/reference?tab=items&sub=tags&kind=item&tag=${encodeURIComponent(tagKey('item', r.id.slice(1)))}`
    : `/reference?tab=items&item=${encodeURIComponent(r.id)}`;
  return (
    <Link to={to} className={styles.ref}>
      {icon && <ItemIcon id={icon} size={20} tip={false} />}
      <span>{isTag ? `любой из тега ${r.id}` : ctx.nameOf(r.id)}</span>
      {r.count ? <span className="faint">×{r.count}</span> : null}
    </Link>
  );
}

const TASK_LABEL: Record<string, string> = {
  checkmark: 'Отметить вручную',
  advancement: 'Получить достижение',
  kill: 'Убить',
  dimension: 'Попасть в измерение',
  biome: 'Найти биом',
  structure: 'Найти постройку',
  observation: 'Осмотреть',
  block: 'Найти блок',
  fluid: 'Набрать жидкость',
  location: 'Прийти в место',
  stat: 'Статистика',
};

function TaskLine({ t, ctx }: { t: QuestTask; ctx: Ctx }) {
  return (
    <li>
      {t.title && <span className={styles.taskTitle}>{t.title}</span>}
      {t.type === 'item' ? (
        <span className={styles.refs}>
          {t.items?.length ? (
            <>
              {t.items.map((r, i) => (
                <span key={r.id} className={styles.refs}>
                  {i > 0 && <span className="faint">или</span>}
                  <RefChip r={r} ctx={ctx} />
                </span>
              ))}
              {t.count ? <span className="faint">×{t.count}</span> : null}
            </>
          ) : (
            <span className="faint">предмет по фильтру</span>
          )}
        </span>
      ) : (
        <span>
          {TASK_LABEL[t.type] ?? t.type}
          {t.target && <span className="faint"> · {t.target}</span>}
          {t.count ? <span className="faint"> ×{t.count}</span> : null}
        </span>
      )}
      {t.optional && <span className="faint small"> (необязательно)</span>}
    </li>
  );
}

function rewardLabel(r: QuestReward) {
  if (r.type === 'xp') return `${r.xp} опыта`;
  if (r.type === 'xp_levels') return `${r.xp} ур. опыта`;
  if (r.title) return r.title;
  return r.type === 'loot' || r.type === 'random' || r.type === 'choice' ? 'Набор наград' : r.type;
}

function QuestLink({ id, ctx, chapter }: { id: string; ctx: Ctx; chapter: QuestChapter }) {
  const hit = ctx.index.get(id);
  if (!hit) return <span className="faint">{id}</span>;
  const icon = questIcon(hit.quest, ctx.tags);
  return (
    <button className={styles.questLink} onClick={() => ctx.onPlace({ chapter: hit.chapter.filename, quest: id })}>
      {icon && <ItemIcon id={icon} size={18} tip={false} />}
      <span>{questTitle(hit.quest, ctx)}</span>
      {hit.chapter.id !== chapter.id && <span className="faint small">· {hit.chapter.title}</span>}
    </button>
  );
}

function QuestCard({ hit, ctx }: { hit: QuestHit; ctx: Ctx }) {
  const { quest: q, chapter } = hit;
  const icon = questIcon(q, ctx.tags);
  const opens = [...ctx.index.values()].filter((h) => h.quest.deps.includes(q.id));
  return (
    <Card className={styles.card}>
      <div className={styles.cardHead}>
        {icon && <ItemIcon id={icon} size={36} />}
        <div>
          <h3>{questTitle(q, ctx)}</h3>
          {q.subtitle && <p className={styles.subtitle}>{q.subtitle}</p>}
        </div>
      </div>
      {q.optional && <p className="faint small">Необязательный квест.</p>}
      {q.desc.length > 0 && (
        <div className={styles.desc}>{q.desc.map((line, i) => (line ? <p key={i}>{line}</p> : <br key={i} />))}</div>
      )}
      {q.tasks.length > 0 && (
        <section>
          <h4>Задачи</h4>
          <ul className={styles.list}>
            {q.tasks.map((t) => (
              <TaskLine key={t.id} t={t} ctx={ctx} />
            ))}
          </ul>
        </section>
      )}
      {q.rewards.length > 0 && (
        <section>
          <h4>Награды</h4>
          <ul className={styles.list}>
            {q.rewards.map((r) => (
              <li key={r.id}>{r.type === 'item' && r.item ? <RefChip r={r.item} ctx={ctx} /> : rewardLabel(r)}</li>
            ))}
          </ul>
        </section>
      )}
      {q.deps.length > 0 && (
        <section>
          <h4>{q.depMode === 'one_completed' ? 'Откроется после любого из' : 'Откроется после'}</h4>
          <div className={styles.links}>
            {q.deps.map((d) => (
              <QuestLink key={d} id={d} ctx={ctx} chapter={chapter} />
            ))}
          </div>
        </section>
      )}
      {opens.length > 0 && (
        <section>
          <h4>Открывает</h4>
          <div className={styles.links}>
            {opens.map((h) => (
              <QuestLink key={h.quest.id} id={h.quest.id} ctx={ctx} chapter={chapter} />
            ))}
          </div>
        </section>
      )}
    </Card>
  );
}

function SearchResults({ hits, ctx }: { hits: QuestHit[]; ctx: Ctx }) {
  if (!hits.length) return <div className="empty">Ничего не нашлось.</div>;
  return (
    <div className={styles.results}>
      <p className="faint small">Найдено квестов: {hits.length}</p>
      {hits.slice(0, 100).map((h) => {
        const icon = questIcon(h.quest, ctx.tags);
        return (
          <button
            key={h.quest.id}
            className={styles.result}
            onClick={() => ctx.onPlace({ chapter: h.chapter.filename, quest: h.quest.id, query: '' })}
          >
            {icon ? <ItemIcon id={icon} size={28} tip={false} /> : <span className={styles.nodeDot} />}
            <span>
              <span className={styles.resultTitle}>{questTitle(h.quest, ctx)}</span>
              <span className="faint small"> · {h.chapter.title}</span>
              {h.quest.subtitle && <span className={cx('faint small', styles.resultSub)}>{h.quest.subtitle}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
