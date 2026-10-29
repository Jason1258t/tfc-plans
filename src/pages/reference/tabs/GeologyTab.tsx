import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardHead, Select, Tag } from '@/shared/ui';
import { ItemIcon, itemName, type ItemIndex } from '@/shared/pack-data';
import type { Vein } from '@/lib/reference';
import { cx } from '@/shared/lib';
import { useSearchTrack } from '@/shared/api';
import { ACIDITY, buildRocks, CATEGORY, type RockCategory, type RockInfo } from '../model/geology';
import shell from '../ReferenceShell.module.css';
import styles from './GeologyTab.module.css';

const lower = (s: string | undefined) => (s ?? '').toLowerCase().replaceAll('ё', 'е');
/** «Raw Granite» → «Granite» */
const english = (items: ItemIndex | null, id: string) => (items?.byId.get(id)?.e ?? '').replace(/^Raw\s+/i, '');

/** Минералы жил породы: один на минерал, иконка — обычный сорт */
function minerals(veins: Vein[]) {
  const map = new Map<string, string>();
  for (const v of veins)
    for (const m of v.minerals) {
      const main = m.items.find((i) => i.grade === 'normal') ?? m.items.find((i) => i.grade === 'single') ?? m.items[0];
      if (main && !map.has(m.mineral)) map.set(m.mineral, main.item);
    }
  return [...map.values()];
}

/** Справочник «Геология»: категории пород из книги TFC, слои по пресету мира, руды в породе, поиск ru/en */
export function GeologyTab({ veins, items }: { veins: Vein[]; items: ItemIndex | null }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<RockCategory | ''>('');

  const rocks = useMemo(() => {
    const name = (r: RockInfo) => itemName(items?.byId.get(r.block), r.key);
    return buildRocks(veins)
      .map((r) => {
        const ores = minerals(r.veins);
        const hay = lower(
          [r.key, r.block, name(r), english(items, r.block), ...ores.map((o) => itemName(items?.byId.get(o), o))].join(
            ' ',
          ),
        );
        return { ...r, ores, hay, nameHay: lower(`${r.key} ${name(r)} ${english(items, r.block)}`) };
      })
      .sort((a, b) => name(a).localeCompare(name(b), 'ru'));
  }, [veins, items]);

  const words = lower(query).split(/\s+/).filter(Boolean);
  const visible = rocks
    .filter((r) => !category || r.category === category)
    .filter((r) => words.every((w) => r.hay.includes(w)))
    // Совпадение по названию породы — выше совпадений по руде
    .sort(
      (a, b) => Number(words.every((w) => b.nameHay.includes(w))) - Number(words.every((w) => a.nameHay.includes(w))),
    );
  useSearchTrack('geology', query, visible.length);

  const rockLabel = (key: string) => itemName(items?.byId.get(`tfc:rock/raw/${key}`), key);
  const rockLinks = (keys: string[]) => (
    <span className={styles.links}>
      {keys.map((k) => (
        <button key={k} type="button" className={styles.rockLink} onClick={() => setQuery(rockLabel(k))}>
          <ItemIcon id={`tfc:rock/raw/${k}`} size={16} />
          {rockLabel(k)}
        </button>
      ))}
    </span>
  );

  return (
    <>
      <details className={styles.intro}>
        <summary>Как устроены породы (по книге TFC)</summary>
        <div className={styles.introBody}>
          <p>
            Мир разделён на области одной породы шириной до километра и больше; под ногами всегда два-три слоя разных
            пород. Руды привязаны к породам, поэтому, зная породу, понятно, какие жилы в ней искать.
          </p>
          <ul>
            {(Object.keys(CATEGORY) as RockCategory[]).map((c) => (
              <li key={c}>
                <b>{CATEGORY[c].label}</b> — {CATEGORY[c].about}
              </li>
            ))}
          </ul>
          <p>
            Под эффузивной породой обычно лежит интрузивная той же кислотности: под базальтом — габбро, под риолитом —
            гранит, под андезитом и дацитом — диорит. Под мелом, известняком и доломитом — мрамор, под кремнистым
            сланцем — кварцит, под сланцем, аргиллитом и конгломератом — шиферный сланец и филлит, а под ними — аспидный
            сланец и гнейс. В горах метаморфические и интрузивные породы выходят на поверхность; дайки интрузивных пород
            встречаются по всему миру.
          </p>
          <p className="faint">
            Точную породу в точке выбирает шум от сида мира — по <Link to="/reference?tab=map">карте</Link> её не
            узнать, только тип области (суша, океан, горы, вулканы). Слои ниже — по пресету мира TFC; в игре не
            проверялось.
          </p>
        </div>
      </details>

      <div className={shell.filters}>
        <label className={cx(shell.search, 'grow')}>
          <Search size={15} className="faint" />
          <input
            placeholder="Порода по-русски или по-английски, или руда: гранит, basalt, касситерит…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <Select
          value={category}
          onChange={(e) => setCategory(e.target.value as RockCategory | '')}
          aria-label="Категория"
        >
          <option value="">Все категории</option>
          {(Object.keys(CATEGORY) as RockCategory[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY[c].label}
            </option>
          ))}
        </Select>
      </div>

      {visible.length === 0 ? (
        <div className="empty">Ничего не найдено</div>
      ) : (
        <div className={styles.grid}>
          {visible.map((r) => (
            <Card key={r.key} className={styles.card}>
              <CardHead>
                <ItemIcon id={r.block} size={32} />
                <div className="grow">
                  <h2>{itemName(items?.byId.get(r.block), r.key)}</h2>
                  <div className="faint small">
                    {english(items, r.block) || r.key} · <code>{r.block}</code>
                  </div>
                </div>
              </CardHead>
              <div className={styles.tags}>
                <Tag data-category={r.category} className={styles.category}>
                  {CATEGORY[r.category].label}
                  {r.acidity && `, ${ACIDITY[r.acidity]}`}
                </Tag>
                {r.flux && <Tag title="Камешки породы — флюс (#tfc:fluxstone)">флюс</Tag>}
                {r.anvil && <Tag title="Сырой камень раскалывается молотом в каменную наковальню">наковальня</Tag>}
                <Tag title="Прочность каменных инструментов из этой категории">
                  инструменты: {CATEGORY[r.category].durability}
                </Tag>
              </div>
              {!r.generates ? (
                <p className="faint small">В мире сборки не появляется: в слоях пресета её нет.</p>
              ) : (
                <dl className={styles.facts}>
                  <dt>Где сверху</dt>
                  <dd>
                    {r.surface.length ? r.surface.join(', ') : 'на поверхность не выходит'}
                    {r.bottom && ' · бывает глубинным слоем под всеми'}
                  </dd>
                  {r.above.length > 0 && (
                    <>
                      <dt>Над ней</dt>
                      <dd>{rockLinks(r.above)}</dd>
                    </>
                  )}
                  {r.below.length > 0 && (
                    <>
                      <dt>Под ней</dt>
                      <dd>{rockLinks(r.below)}</dd>
                    </>
                  )}
                  <dt>Руды</dt>
                  <dd>
                    {r.ores.length ? (
                      <span className={styles.ores}>
                        {r.ores.map((o) => (
                          <span key={o} className={styles.ore} title={o}>
                            <ItemIcon id={o} size={18} />
                            {itemName(items?.byId.get(o), o)}
                          </span>
                        ))}
                        <Link to={`/reference?rock=${encodeURIComponent(r.block)}`} className="small">
                          жилы →
                        </Link>
                      </span>
                    ) : (
                      <span className="faint">жил нет</span>
                    )}
                  </dd>
                </dl>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
