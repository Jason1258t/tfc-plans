import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CROP_BLOCK_LABEL,
  expiryDays,
  FOOD_TRAIT_LABEL,
  growthDays,
  inRange,
  LIFE_LABEL,
  monthLabel,
  PLANT_KIND_LABEL,
  PLANTER_LABEL,
  qualityCondition,
  rangeLabel,
  useBotany,
  type BotanyMeta,
  type BotanySub,
  type GreenhousePlant,
  type Plant,
  type PlantKind,
} from '@/lib/botany';
import { useBotanyConfig, type BotanyConfig } from '@/lib/botanyConfig';
import { CONFIG_ORIGIN_LABEL } from '@/lib/config';
import { itemName, useItems, type ItemIndex, useTags, ItemIcon } from '@/shared/pack-data';
import { mealsByItem, useMeals, type MealRef } from '@/lib/meals';
import type { Food } from '@/lib/reference';
import { cx } from '@/shared/lib';
import '../ReferenceShared.css';
import shell from '../ReferenceShell.module.css';
import styles from './BotanyTab.module.css';

const SUBTABS: PlantKind[] = ['crop', 'bush', 'tree', 'plant'];
type Sort = 'name' | 'minT' | 'maxT';

const lower = (s: string) => s.toLowerCase().replaceAll('ё', 'е');
const prettyName = (n: string) => n.replaceAll('_', ' ');

/** Ботаника: культуры, ягодные кусты, фруктовые деревья — диапазоны температуры и влажности из данных TFC */
export function BotanyTab({
  foods,
  sub: subtab,
  onSub,
}: {
  foods: Food[];
  sub: BotanySub;
  onSub: (k: BotanySub) => void;
}) {
  // Теплица — отдельная механика со своим списком; остальные подвкладки — растения открытого грунта
  const sub: PlantKind = subtab === 'greenhouse' ? 'crop' : subtab;
  const botany = useBotany();
  const plants = botany === undefined ? undefined : (botany?.entries ?? null);
  const meta = botany?.meta ?? {};
  const items = useItems();
  const [query, setQuery] = useState('');
  const [temp, setTemp] = useState('');
  const [hydr, setHydr] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const config = useBotanyConfig(meta);

  const counts = useMemo(() => {
    const c: Record<PlantKind, number> = { crop: 0, bush: 0, tree: 0, plant: 0 };
    for (const p of plants ?? []) c[p.k]++;
    return c;
  }, [plants]);
  const foodBy = useMemo(() => {
    const m = new Map<string, Food>();
    for (const f of foods) for (const id of f.items) if (!m.has(id)) m.set(id, f);
    return m;
  }, [foods]);

  // Сборные блюда, куда годится плод: по слотам блюд и составу тегов начинок (с правками KubeJS)
  const meals = useMeals();
  const tagCat = useTags();
  const mealsBy = useMemo(
    () => (meals && tagCat ? mealsByItem(meals, tagCat, (id) => itemName(items?.byId.get(id), id)) : null),
    [meals, tagCat, items],
  );

  const nameOf = (p: Plant) => (p.product ? itemName(items?.byId.get(p.product), p.product) : prettyName(p.n));

  const list = useMemo(() => {
    if (!plants) return [];
    const t = temp.trim() === '' ? null : Number(temp.replace(',', '.'));
    const h = hydr.trim() === '' ? null : Number(hydr.replace(',', '.'));
    const words = lower(query).split(/\s+/).filter(Boolean);
    const name = (p: Plant) => lower(p.product ? itemName(items?.byId.get(p.product), p.product) : prettyName(p.n));
    return plants
      .filter((p) => p.k === sub)
      .filter((p) => {
        const hay = `${name(p)} ${lower(p.i)} ${lower(items?.byId.get(p.product ?? '')?.e ?? '')}`;
        return words.every((w) => hay.includes(w));
      })
      .filter((p) => t === null || Number.isNaN(t) || inRange(t, p.r.minT, p.r.maxT))
      .filter((p) => h === null || Number.isNaN(h) || inRange(h, p.r.minH, p.r.maxH))
      .sort((a, b) =>
        sort === 'name'
          ? name(a).localeCompare(name(b), 'ru')
          : sort === 'minT'
            ? (a.r.minT ?? -99) - (b.r.minT ?? -99)
            : (b.r.maxT ?? 99) - (a.r.maxT ?? 99),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plants, sub, query, temp, hydr, sort, items]);

  /** Общая шкала для полосок диапазонов: от самого холодного до самого жаркого растения в данных */
  const scale = useMemo(() => {
    const ts = (plants ?? []).flatMap((p) => [p.r.minT, p.r.maxT]).filter((v): v is number => v !== undefined);
    return { minT: Math.floor(Math.min(-10, ...ts) / 5) * 5, maxT: Math.ceil(Math.max(35, ...ts) / 5) * 5 };
  }, [plants]);

  if (plants === undefined) return <div className="empty">Загружаю ботанику…</div>;
  if (plants === null) return <div className="empty">Данных о растениях нет — выполните npm run mods</div>;

  return (
    <div className="botany">
      <nav className="botany-nav" aria-label="Разделы ботаники">
        {SUBTABS.filter((k) => k !== 'plant' || counts.plant > 0).map((k) => (
          <button key={k} className={cx(subtab === k && 'active')} onClick={() => onSub(k)}>
            <span>{PLANT_KIND_LABEL[k]}</span>
            <span className="faint small">{counts[k]}</span>
          </button>
        ))}
        {(botany?.greenhouse.length ?? 0) > 0 && (
          <button className={cx(subtab === 'greenhouse' && 'active')} onClick={() => onSub('greenhouse')}>
            <span>Теплица</span>
            <span className="faint small">{botany!.greenhouse.length}</span>
          </button>
        )}
      </nav>

      {subtab === 'greenhouse' ? (
        <Greenhouse
          list={botany?.greenhouse ?? []}
          items={items}
          config={config}
          foodBy={foodBy}
          tiers={meta.greenhouseTiers ?? []}
          growth={meta.greenhouseGrowth}
          reasons={meta.greenhouseReasons ?? []}
          water={meta.greenhouseWater}
        />
      ) : (
        <div className="botany-main">
          <div className={cx(shell.filters, shell.filtersEnd)}>
            <label className="search grow">
              <Search size={15} className="faint" />
              <input
                placeholder={
                  sub === 'crop' ? 'Пшеница, картофель…' : sub === 'bush' ? 'Малина, черника…' : 'Яблоня, олива…'
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span className="faint small">Температура, °C</span>
              <input
                className="input"
                inputMode="decimal"
                placeholder="напр. 12"
                value={temp}
                onChange={(e) => setTemp(e.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span className="faint small">Влажность, %</span>
              <input
                className="input"
                inputMode="decimal"
                placeholder="напр. 40"
                value={hydr}
                onChange={(e) => setHydr(e.target.value)}
              />
            </label>
            <select
              className="input"
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              aria-label="Порядок"
            >
              <option value="name">По названию</option>
              <option value="minT">Сначала холодостойкие</option>
              <option value="maxT">Сначала жаростойкие</option>
            </select>
          </div>

          <Summary meta={meta} sub={sub} config={config} shown={list.length} total={counts[sub]} items={items} />

          {list.length === 0 ? (
            <div className="empty">Ничего не подходит.</div>
          ) : (
            <ul className={styles.grid}>
              {list.map((p) => (
                <PlantCard
                  key={p.i}
                  p={p}
                  name={nameOf(p)}
                  food={p.product ? foodBy.get(p.product) : undefined}
                  dishes={mealsBy ? (p.product && mealsBy.get(p.product)) || [] : undefined}
                  items={items}
                  meta={meta}
                  config={config}
                  scale={scale}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const ru = (v: number, digits = 1) => String(Math.round(v * 10 ** digits) / 10 ** digits).replace('.', ',');
const TICKS_PER_DAY = 24000;
/** Игровые сутки — 20 минут реального времени при 20 тиках в секунду */
const DAY_MINUTES = 20;
const hours = (min: number) => (min >= 90 ? `${ru(min / 60)} ч` : `${Math.round(min)} мин`);

/** Календарь сервера: длина месяца и то, сколько реального времени идут календарные сутки */
function calendar(config: BotanyConfig) {
  const month = config.num('defaultMonthLength');
  const rate = config.num('calendarTickRate');
  const dayLength = config.num('defaultCalendarDayLength');
  // Скорость календаря = 20 / длина календарных суток в минутах (так её считает мод); в мире хранится уже скорость
  const dayMinutes = rate ? DAY_MINUTES / rate.value : (dayLength?.value ?? null);
  return { month, dayMinutes, dayOrigin: rate?.origin ?? dayLength?.origin ?? null };
}

/** Общие для подраздела сроки — блоком над карточками, чтобы не повторять на каждой */
function Summary({
  meta,
  sub,
  config,
  shown,
  total,
  items,
}: {
  meta: BotanyMeta;
  sub: PlantKind;
  config: BotanyConfig;
  shown: number;
  total: number;
  items: ItemIndex | null;
}) {
  // Пашня — блок без предмета; название почвы берём у земли того же вида (farmland/x → dirt/x)
  const soilName = (block: string) => {
    const it = items?.byId.get(block.replace('farmland/', 'dirt/'));
    return it ? itemName(it) : (block.split('/').pop() ?? block);
  };
  const cal = calendar(config);
  const facts: { label: string; value: string; note?: string }[] = [];
  if (sub === 'crop') {
    const modifier = config.num('cropGrowthModifier');
    const days = growthDays(meta, modifier?.value ?? 1);
    if (days) {
      facts.push({
        label: 'Созревание',
        value: `${Math.round(days.best)}–${Math.round(days.base)} игровых суток`,
        note: `быстрее — на почве, где хватает всех нужных элементов; это ${hours(days.best * DAY_MINUTES)}–${hours(days.base * DAY_MINUTES)} игры`,
      });
      const expiryMod = config.num('cropExpiryModifier');
      const rot = expiryDays(meta, expiryMod?.value ?? 1);
      if (rot)
        facts.push({
          label: 'Перестоявшая культура',
          value: `гибнет через ~${Math.round(rot)} игровых суток после созревания`,
          note: `на удобренной почве быстрее; вне диапазона климата культура не растёт и стареет с той же скоростью${
            expiryMod ? `; множитель порчи ${ru(expiryMod.value, 2)} — ${CONFIG_ORIGIN_LABEL[expiryMod.origin]}` : ''
          }`,
        });
      if (modifier)
        facts.push({
          label: 'Множитель роста',
          value: ru(modifier.value, 2),
          note: CONFIG_ORIGIN_LABEL[modifier.origin],
        });
    }
    if (meta.minLight !== undefined)
      facts.push({ label: 'Свет', value: `яркость не ниже ${meta.minLight}`, note: 'иначе культура не растёт' });
    if (meta.soil?.length)
      facts.push({
        label: 'Почва',
        value: meta.soil.map((x) => `${x.blocks.map(soilName).join(', ')} ×${ru(x.mul, 2)}`).join(' · '),
        note: 'множитель к тому, сколько элементов культура возвращает в почву; остальные почвы ×1',
      });
    const from = config.get('wildCropMaturityStartMonth');
    const to = config.get('wildCropMaturityEndMonth');
    const months = meta.months ?? [];
    if (from && to && typeof from.value === 'string' && typeof to.value === 'string')
      facts.push({
        label: 'Дикие культуры спелые',
        value: `${monthLabel(from.value, months.indexOf(from.value))} – ${monthLabel(to.value, months.indexOf(to.value))}`,
        note: CONFIG_ORIGIN_LABEL[from.origin],
      });
  } else {
    const bloom = config.num('fruitPickBloomDelayTicks');
    if (bloom)
      facts.push({
        label: 'После сбора',
        value: `${ru(bloom.value / TICKS_PER_DAY)} игровых суток до новых плодов`,
        note: CONFIG_ORIGIN_LABEL[bloom.origin],
      });
  }
  if (cal.month)
    facts.push({
      label: 'Месяц',
      value: `${ru(cal.month.value)} календарных суток`,
      note:
        CONFIG_ORIGIN_LABEL[cal.month.origin] +
        (cal.dayMinutes ? `; это ${hours(cal.month.value * cal.dayMinutes)} игры` : ''),
    });
  if (cal.dayMinutes && cal.dayOrigin)
    facts.push({
      label: 'Календарные сутки',
      value: hours(cal.dayMinutes),
      note: `${CONFIG_ORIGIN_LABEL[cal.dayOrigin]}; игровые сутки (день и ночь) — ${DAY_MINUTES} мин`,
    });
  return (
    <section className={styles.summary}>
      <dl>
        {facts.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>
              <b>{f.value}</b>
              {f.note && <span className="faint small"> · {f.note}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <p className="faint small">
        {sub === 'crop'
          ? 'Срок созревания у всех культур общий. Удобрения: «берёт» — культура забирает элемент из почвы, «возвращает» — пополняет его.'
          : 'Календарь показывает состояние растения по месяцам; собирать плоды можно в месяцы «плодоносит».'}{' '}
        Вне диапазона температуры и влажности растение не растёт. Всё взято из файлов сборки, в игре не проверялось.
        Показано {shown} из {total}.
      </p>
      {sub !== 'crop' && (
        <p className={cx(styles.legend, 'small')}>
          {(Object.keys(LIFE_LABEL) as (keyof typeof LIFE_LABEL)[]).map((l) => (
            <span key={l}>
              <i data-life={l.toLowerCase()} /> {LIFE_LABEL[l]}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

const USES_SHOWN = 10;
const NPK_NAME = ['Азот', 'Фосфор', 'Калий'];
const NPK_LETTER = ['N', 'P', 'K'];

/** Полоска диапазона на общей шкале; открытая граница (нет в данных) уходит в край с затуханием */
function RangeBar({
  min,
  max,
  lo,
  hi,
  kind,
}: {
  min?: number;
  max?: number;
  lo: number;
  hi: number;
  kind: 'temp' | 'water';
}) {
  const pos = (v: number) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  const left = min === undefined ? 0 : pos(min);
  const right = max === undefined ? 100 : pos(max);
  return (
    <span className={styles.bar} data-kind={kind} aria-hidden="true">
      <span
        className={cx(min === undefined && styles.openLeft, max === undefined && styles.openRight)}
        style={{ left: `${left}%`, width: `${Math.max(2, right - left)}%` }}
      />
    </span>
  );
}

function PlantCard({
  p,
  name,
  food,
  dishes,
  items,
  meta,
  config,
  scale,
}: {
  p: Plant;
  name: string;
  food?: Food;
  /** Сборные блюда, куда годится плод; undefined — блюда или теги ещё не загружены */
  dishes?: MealRef[];
  items: ItemIndex | null;
  meta: BotanyMeta;
  config: BotanyConfig;
  scale: { minT: number; maxT: number };
}) {
  const icon = p.product ?? p.plant ?? p.seed;
  const seedName = p.seed ? itemName(items?.byId.get(p.seed), p.seed) : null;
  const months = meta.months ?? [];

  // Срок роста саженца: ключ сервера на каждое дерево (cherrySaplingGrowthTicks), иначе значение из кода мода
  const camel = p.n.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
  const modifier = config.num('saplingGrowthModifier')?.value ?? 1;
  const own =
    p.k === 'tree'
      ? (config.num('saplingGrowthTicks', { name: camel }) ?? config.num(`${camel}SaplingGrowthTicks`))
      : null;
  const sapling = own
    ? { days: (own.value * modifier) / TICKS_PER_DAY, origin: CONFIG_ORIGIN_LABEL[own.origin] }
    : p.growDays !== undefined
      ? { days: p.growDays * modifier, origin: 'значение мода по умолчанию' }
      : null;

  // Сколько плодов за один сбор: свой класс растения (BananaPlantBlock) или общий для кустов и листвы
  const pickClass = Object.keys(meta.pick ?? {}).find((c) => c.toLowerCase().startsWith(p.n.replace(/_/g, '')));
  const pick = p.life && p.k !== 'plant' ? (meta.pick?.[pickClass ?? 'SeasonalPlantBlock'] ?? null) : null;
  const fruiting = (p.life ?? []).flatMap((l, i) => (l === 'FRUITING' ? [monthLabel(months[i], i)] : []));

  return (
    <li className={styles.card}>
      <header className={styles.cardHead}>
        {icon ? <ItemIcon id={icon} size={40} tip={false} /> : <span className={styles.noicon} />}
        <div className="grow">
          <div className={styles.name}>{name}</div>
          <code className="faint small">{p.i}</code>
        </div>
        {p.block && <span className={styles.chip}>{CROP_BLOCK_LABEL[p.block] ?? p.block}</span>}
        {p.spreading && <span className={styles.chip}>раскидистый{p.maxHeight ? `, до ${p.maxHeight} бл.` : ''}</span>}
      </header>

      <section>
        <h4>Где растёт</h4>
        <div className={styles.range}>
          <span>Температура</span>
          <RangeBar min={p.r.minT} max={p.r.maxT} lo={scale.minT} hi={scale.maxT} kind="temp" />
          <b>
            {rangeLabel(p.r.minT, p.r.maxT, '°C') ?? '—'}
            {p.r.wigT ? ` ±${ru(p.r.wigT)}` : ''}
          </b>
        </div>
        <div className={styles.range}>
          <span>Влажность</span>
          {p.tempOnly ? (
            <span className="faint">на рост не влияет</span>
          ) : (
            <RangeBar min={p.r.minH} max={p.r.maxH} lo={0} hi={100} kind="water" />
          )}
          <b>
            {p.tempOnly ? '' : (rangeLabel(p.r.minH, p.r.maxH, '%') ?? '—')}
            {p.r.wigH ? ` ±${ru(p.r.wigH)}` : ''}
          </b>
        </div>
      </section>

      {p.npk && (
        <section>
          <h4>Удобрения</h4>
          <div className={styles.npk}>
            {p.npk.map((v, i) => (
              <div key={i} data-kind={v > 0 ? 'takes' : v < 0 ? 'gives' : undefined}>
                <b>{NPK_LETTER[i]}</b>
                <span>{NPK_NAME[i]}</span>
                <em>{v > 0 ? `берёт ${ru(v, 2)}` : v < 0 ? `возвращает ${ru(-v, 2)}` : 'не влияет'}</em>
              </div>
            ))}
          </div>
        </section>
      )}

      {(p.drops || food || seedName || p.grow) && (
        <section>
          <h4>{p.k === 'crop' ? 'Урожай' : 'Плод'}</h4>
          <dl className={styles.stats}>
            {p.drops?.map((d) => (
              <div key={d.item}>
                <dt>
                  {d.item === p.seed
                    ? 'Семена'
                    : d.item === p.product
                      ? 'Плоды'
                      : itemName(items?.byId.get(d.item), d.item)}
                </dt>
                <dd>
                  {d.min === d.max ? d.max : `${d.min}–${d.max}`} шт.{d.byYield && ' — зависит от ухода'}
                </dd>
              </div>
            ))}
            {pick && (
              <div>
                <dt>За один сбор</dt>
                <dd>
                  {pick[0] === pick[1] ? pick[0] : `${pick[0]}–${pick[1]}`} шт.
                  {p.k === 'tree' && pick[0] === pick[1] ? ' с блока листвы' : p.k === 'bush' ? ' с блока куста' : ''}
                </dd>
              </div>
            )}
            {food && (
              <div>
                <dt>Еда</dt>
                <dd>
                  сытость {food.hunger || '—'}, портится ×{ru(food.decay, 2)}
                </dd>
              </div>
            )}
            {seedName && (
              <div>
                <dt>Сажать</dt>
                <dd className={styles.seed}>
                  <ItemIcon id={p.seed} size={18} tip={false} /> {seedName}
                </dd>
              </div>
            )}
            {sapling && (
              <div>
                <dt>Саженец</dt>
                <dd>
                  растёт {ru(sapling.days)} игровых суток <span className="faint small">· {sapling.origin}</span>
                </dd>
              </div>
            )}
            {p.grow && (
              <div>
                <dt>Рост</dt>
                <dd>
                  новая стадия раз в {ru(p.grow.interval / TICKS_PER_DAY / p.grow.max)}–
                  {ru(p.grow.interval / TICKS_PER_DAY / p.grow.min)} игровых суток, пока температура в диапазоне; вне
                  его — покой
                </dd>
              </div>
            )}
            {p.stages && (
              <div>
                <dt>Стадий роста</dt>
                <dd>{p.stages.join(' + ')}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {p.life && (
        <section>
          <h4>
            Календарь
            {fruiting.length > 0 && <span className="faint"> · плодоносит: {fruiting.join(', ')}</span>}
          </h4>
          <ol className={styles.life}>
            {p.life.map((l, i) => (
              <li
                key={i}
                data-life={l ? l.toLowerCase() : undefined}
                title={`${monthLabel(months[i], i)}: ${l ? LIFE_LABEL[l] : '—'}`}
              >
                {monthLabel(months[i], i)}
              </li>
            ))}
          </ol>
        </section>
      )}

      {p.uses && (p.uses.items.length > 0 || p.uses.generic || dishes?.length) && (
        <section>
          <h4>
            Куда идёт <span className="faint">· рецептов: {p.uses.recipes}</span>
          </h4>
          <div className={styles.uses}>
            {p.uses.items.slice(0, USES_SHOWN).map((id) => (
              <ItemIcon key={id} id={id} size={28} />
            ))}
            {p.uses.items.length > USES_SHOWN && (
              <span className="faint small">и ещё {p.uses.items.length - USES_SHOWN}</span>
            )}
            {!dishes && p.uses.generic ? <span className="faint small">+ сборные блюда: {p.uses.generic}</span> : null}
          </div>
          {dishes && dishes.length > 0 && (
            <div className={cx(styles.dishes, 'small')}>
              <span className="faint">В сборные блюда:</span>
              {dishes.map((d) => (
                <Link key={d.key + d.title} to={`/reference?tab=food&sub=meals&q=${encodeURIComponent(name)}`}>
                  {d.title}
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {p.vine && (
        <section>
          <h4>Лоза</h4>
          <ul className={styles.notes}>
            {p.vine.stages && <li>Росток у земли проходит {p.vine.stages} стадии.</li>}
            {p.vine.up && <li>Взрослый росток поднимается на шпагат над собой — без шпагата выше он не растёт.</li>}
            {p.vine.sideways && <li>Дальше лоза расходится вдоль шпагата в обе стороны и на столбы шпалеры.</li>}
            {p.vine.canopy && <li>Над лозой вырастает крона, если блок сверху свободен.</li>}
            {p.vine.pick && (
              <li>
                Сбор: {p.vine.pick} шт. с каждого плодоносящего блока лозы
                {p.vine.oncePerSeason && ', после сбора блок снова просто растёт до следующего сезона'}.
              </li>
            )}
          </ul>
        </section>
      )}

      {p.quality && (
        <section>
          <h4>
            Качество урожая
            {p.quality.radius ? (
              <span className="faint"> · считается в {p.quality.radius} блоках вокруг лозы</span>
            ) : null}
          </h4>
          {p.quality.radius && p.quality.row ? (
            <p className={cx('small', styles.qualityNote)}>
              Каждое растение лозы осматривает квадрат {p.quality.radius * 2 + 1}×{p.quality.radius * 2 + 1} вокруг себя
              {p.quality.layers === 2 ? ' на своём уровне и уровнем ниже' : ''} ({(p.quality.radius * 2 + 1) ** 2}{' '}
              блоков в слое). Счётчики складываются по всему ряду: по растениям, стоящим через каждые{' '}
              {p.quality.row.step} блока вдоль шпагата, пока ряд не прервётся
              {p.quality.row.unbounded ? '; длина ряда не ограничена' : ''}. Пороги-числа сравниваются с суммой по ряду
              и с длиной не растут, а области соседних растений перекрываются, так что общие блоки считаются несколько
              раз.
            </p>
          ) : null}
          <dl className={styles.quality}>
            {p.quality.traits.map((t) => {
              // Имя ключа конфига: «Dirt_grown» из DIRT_GROWN
              const cap = t.trait.charAt(0) + t.trait.slice(1).toLowerCase();
              const mod = config.num('foodTraitModifier', { name: cap })?.value ?? meta.foodTraits?.[t.trait];
              return (
                <div key={t.trait}>
                  <dt>
                    {FOOD_TRAIT_LABEL[t.trait] ?? t.trait.toLowerCase().replaceAll('_', ' ')}
                    {mod !== undefined && <span className="faint small"> · порча ×{ru(mod, 2)}</span>}
                  </dt>
                  <dd>{t.when.map(qualityCondition).join('; ')}</dd>
                </div>
              );
            })}
          </dl>
        </section>
      )}

      {p.wild && (
        <section>
          <h4>В природе</h4>
          <p className={styles.wild}>
            {[
              rangeLabel(p.wild.minT, p.wild.maxT, '°C'),
              rangeLabel(p.wild.minW, p.wild.maxW, 'мм грунтовой влаги'),
              p.wild.rarity ? `редкость 1 из ${p.wild.rarity}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </section>
      )}
    </li>
  );
}

/** Теплица Firmalife: что сажать, в какую грядку, какой уровень теплицы нужен */
function Greenhouse({
  list,
  items,
  config,
  foodBy,
  tiers,
  growth,
  reasons,
  water,
}: {
  list: GreenhousePlant[];
  items: ItemIndex | null;
  config: BotanyConfig;
  foodBy: Map<string, Food>;
  tiers: NonNullable<BotanyMeta['greenhouseTiers']>;
  growth?: BotanyMeta['greenhouseGrowth'];
  reasons: NonNullable<BotanyMeta['greenhouseReasons']>;
  water?: BotanyMeta['greenhouseWater'];
}) {
  /** Самый простой материал стен, дающий нужный уровень */
  const wallsFor = (tier: number) => tiers.find((t) => t.tier >= tier);
  const [query, setQuery] = useState('');
  const [planter, setPlanter] = useState('');
  const planters = useMemo(() => [...new Set(list.flatMap((g) => (g.planter ? [g.planter] : [])))].sort(), [list]);
  const nameOf = (g: GreenhousePlant) => (g.crop ? itemName(items?.byId.get(g.crop), g.crop) : prettyName(g.n));
  const shown = list
    .filter((g) => !planter || g.planter === planter)
    .filter((g) => {
      const hay = lower(`${nameOf(g)} ${g.i} ${items?.byId.get(g.crop ?? '')?.e ?? ''}`);
      return lower(query)
        .split(/\s+/)
        .filter(Boolean)
        .every((w) => hay.includes(w));
    })
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'ru'));

  const facts: { label: string; value: string; note?: string }[] = [];
  const fact = (name: string, label: string, fmt: (v: number) => string) => {
    const r = config.num(name);
    if (r) facts.push({ label, value: fmt(r.value), note: CONFIG_ORIGIN_LABEL[r.origin] });
  };
  // Та же формула, что у культур в поле (проверено по байткоду): прирост за тик = GROWTH_FACTOR / множитель,
  // плюс расход удобрения × NUTRIENT_GROWTH_FACTOR; расход = 1 / (суток на элемент × 24000)
  const g = growth;
  const modifier = config.num('greenhouseGrowthModifier')?.value ?? 1;
  const nutrientDays = config.num('greenhouseNutrientDays')?.value;
  if (g) {
    const rate = g.GROWTH_FACTOR / modifier;
    const bonus = nutrientDays ? (1 / (nutrientDays * TICKS_PER_DAY)) * g.NUTRIENT_GROWTH_FACTOR : 0;
    const base = 1 / rate / TICKS_PER_DAY;
    const best = 1 / (rate + bonus) / TICKS_PER_DAY;
    facts.push({
      label: 'Созревание',
      value: `${Math.round(best)}–${Math.round(base)} игровых суток`,
      note: `быстрее — когда в грядке хватает всех нужных элементов; это ${hours(best * DAY_MINUTES)}–${hours(base * DAY_MINUTES)} игры`,
    });
  }
  fact('greenhouseGrowthModifier', 'Множитель роста', (v) => ru(v, 2));
  fact('greenhouseWaterDays', 'Вода в грядке', (v) => `расходуется в среднем за ${ru(v)} суток`);
  fact('greenhouseNutrientDays', 'Элемент удобрения', (v) => `расходуется в среднем за ${ru(v)} суток`);
  if (tiers.length)
    facts.push({
      label: 'Уровни теплицы по материалу стен',
      value: tiers.map((t) => `${t.r ?? t.e} — ${t.tier}`).join(' · '),
    });
  fact('greenhouseRadius', 'Стены от станции климата', (v) => `не дальше ${ru(v)} блоков`);

  // Полив: вода в грядке — доля от 0 до 1; растущее растение расходует 1 / (суток × 24000) за тик
  const waterDays = config.num('greenhouseWaterDays')?.value;
  const pct = (v: number) => `${ru(v * 100)}%`;
  const itemLabel = (id: string | undefined, fallback: string) => (id ? itemName(items?.byId.get(id), id) : fallback);
  const watering: { key: string; title: string; text: string }[] = [];
  if (water && waterDays) {
    watering.push({
      key: 'use',
      title: 'Расход',
      text:
        `полной грядки хватает одному растению на ${ru(waterDays)} игровых суток роста` +
        (water.perSlot
          ? `; каждое растущее растение пьёт отдельно, поэтому четыре растения в одной грядке осушат её за ${ru(waterDays / 4)} суток. Созревшее растение воду не расходует`
          : ''),
    });
    const can = water.can;
    if (can?.add) {
      const side = can.radius !== undefined ? can.radius * 2 + 1 : null;
      watering.push({
        key: 'can',
        title: itemLabel(can.item, 'Лейка'),
        text: [
          `одно применение добавляет ${pct(can.add)} воды` +
            (side
              ? ` всем грядкам в кубе ${side}×${(can.radiusY ?? can.radius ?? 0) * 2 + 1}×${side} вокруг игрока`
              : ''),
          `этого хватает одному растению на ${ru(can.add * waterDays)} суток, с сухой до полной — ${Math.ceil(1 / can.add)} применения`,
          can.useTicks ? `держать ${ru(can.useTicks / 20)} с` : '',
          can.durability ? `одной заправки хватает на ${can.durability} применений` : '',
          can.refill ? 'заправляется кликом по воде' : '',
        ]
          .filter(Boolean)
          .join('; '),
      });
    }
    const sp = water.sprinkler;
    if (sp?.add && sp.interval) {
      const fillMin = (sp.interval / sp.add / 20 / 60) * 1;
      const drink = sp.interval / (waterDays * TICKS_PER_DAY);
      const zones = (water.zones ?? [])
        .map((z) => {
          const side = z.radius * 2 + 1;
          const [a, b] = z.y.map(Math.abs).sort((x, y) => x - y);
          return z.y[1] < 0
            ? `под потолком — квадрат ${side}×${side}, от ${a} до ${b} блоков ниже себя`
            : `на полу — квадрат ${side}×${side}, от ${a} до ${b} блоков выше себя`;
        })
        .join('; ');
      const pipes = sp.pipeConfig ? config.get(sp.pipeConfig) : null;
      const sources = (sp.sources ?? []).map((id) => itemLabel(id, id).toLowerCase()).join(' или ');
      const byPipes = `вода идёт по трубам${sp.pipeMax ? ` (не длиннее ${sp.pipeMax} блоков)` : ''}${sources ? `, в конце нужны ${sources}` : ''}`;
      const byTank = `вода берётся из ёмкости с пресной водой вплотную к оросителю${sp.tankDrain ? `, по ${sp.tankDrain} мБ за раз` : ''}`;
      watering.push({
        key: 'sprinkler',
        title: itemLabel(water.zones?.find((z) => z.item)?.item, 'Ороситель'),
        text: [
          `каждые ${ru(sp.interval / 20)} с добавляет ${pct(sp.add)} воды всем грядкам своей зоны: сухая грядка наполняется за ${ru(fillMin)} мин`,
          `растение за это время выпивает ${ru(drink * 100, 3)}%, так что под работающим оросителем грядка всегда полная`,
          zones ? `зона: ${zones}` : '',
          pipes
            ? `${pipes.value === false ? byTank : byPipes} (${CONFIG_ORIGIN_LABEL[pipes.origin]})`
            : `${byPipes}; если трубы отключены настройкой — ${byTank}`,
        ]
          .filter(Boolean)
          .join('; '),
      });
    }
    const special = [
      ...(water.notFromBelow ?? []).map((k) => `${PLANTER_LABEL[k] ?? k} не принимает воду от оросителя снизу`),
      ...(water.noWatering ?? []).map(
        (k) => `${PLANTER_LABEL[k] ?? k} не поливается и воду не расходует — ей нужна подведённая снизу труба с водой`,
      ),
    ];
    if (special.length) watering.push({ key: 'special', title: 'Особые грядки', text: special.join('; ') });
  }

  return (
    <div className="botany-main">
      <div className={cx(shell.filters, shell.filtersEnd)}>
        <label className="search grow">
          <Search size={15} className="faint" />
          <input placeholder="Томат, ваниль, виноград…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <select className="input" value={planter} onChange={(e) => setPlanter(e.target.value)} aria-label="Грядка">
          <option value="">Любая грядка</option>
          {planters.map((p) => (
            <option key={p} value={p}>
              {PLANTER_LABEL[p] ?? p}
            </option>
          ))}
        </select>
      </div>
      <section className={styles.summary}>
        <dl>
          {facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>
                <b>{f.value}</b>
                {f.note && <span className="faint small"> · {f.note}</span>}
              </dd>
            </div>
          ))}
        </dl>
        {reasons.length > 0 && (
          <div className={cx(styles.reasons, 'small')}>
            <b>Грядка не растёт, если</b>
            <ul>
              {reasons.map((r) => (
                <li key={r.key}>{r.r ?? r.e}</li>
              ))}
            </ul>
            <span className="faint">Формулировки — из перевода самого мода.</span>
          </div>
        )}
        {watering.length > 0 && (
          <div className={cx(styles.reasons, 'small')}>
            <b>Полив</b>
            <ul>
              {watering.map((w) => (
                <li key={w.key}>
                  <b>{w.title}:</b> {w.text}.
                </li>
              ))}
            </ul>
            <span className="faint">Числа — из кода Firmalife, формулировки наши.</span>
          </div>
        )}
        <p className="faint small">
          Теплица Firmalife — отдельная механика: растения сажают в грядки внутри теплицы, климат и сезоны снаружи на
          них не действуют. На карточке указан самый простой материал стен, в теплице из которого растение приживётся.
          Настройки описаны по комментариям мода к ним. В игре не проверялось. Показано {shown.length} из {list.length}.
        </p>
      </section>
      {shown.length === 0 ? (
        <div className="empty">Ничего не подходит.</div>
      ) : (
        <ul className={styles.grid}>
          {shown.map((g) => {
            const food = g.crop ? foodBy.get(g.crop) : undefined;
            const seedName = g.seed ? itemName(items?.byId.get(g.seed), g.seed) : null;
            return (
              <li key={g.i} className={styles.card}>
                <header className={styles.cardHead}>
                  {g.crop ? <ItemIcon id={g.crop} size={40} tip={false} /> : <span className={styles.noicon} />}
                  <div className="grow">
                    <div className={styles.name}>{nameOf(g)}</div>
                    <code className="faint small">{g.i}</code>
                  </div>
                  {g.planter && <span className={styles.chip}>{PLANTER_LABEL[g.planter] ?? g.planter}</span>}
                </header>
                {g.npk && (
                  <section>
                    <h4>Удобрения</h4>
                    <div className={styles.npk}>
                      {g.npk.map((v, i) => (
                        <div key={i} data-kind={v > 0 ? 'takes' : v < 0 ? 'gives' : undefined}>
                          <b>{NPK_LETTER[i]}</b>
                          <span>{NPK_NAME[i]}</span>
                          <em>{v > 0 ? `берёт ${ru(v, 2)}` : v < 0 ? `возвращает ${ru(-v, 2)}` : 'не влияет'}</em>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                <section>
                  <h4>Посадка и урожай</h4>
                  <dl className={styles.stats}>
                    {g.tier !== undefined && (
                      <div>
                        <dt>Теплица</dt>
                        <dd>
                          {wallsFor(g.tier)
                            ? `${(wallsFor(g.tier)!.r ?? wallsFor(g.tier)!.e).toLowerCase()} и лучше`
                            : 'нет подходящей'}{' '}
                          <span className="faint small">· уровень {g.tier}</span>
                        </dd>
                      </div>
                    )}
                    {seedName && (
                      <div>
                        <dt>Сажать</dt>
                        <dd className={styles.seed}>
                          <ItemIcon id={g.seed} size={18} tip={false} /> {seedName}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt>Урожай</dt>
                      <dd>
                        {g.cropCount ?? 1} шт. за сбор
                        {g.extraSeed ? `, шанс лишнего семени ${ru(g.extraSeed * 100)} %` : ''}
                      </dd>
                    </div>
                    {food && (
                      <div>
                        <dt>Еда</dt>
                        <dd>
                          сытость {food.hunger || '—'}, портится ×{ru(food.decay, 2)}
                        </dd>
                      </div>
                    )}
                    {g.stages !== undefined && (
                      <div>
                        <dt>Стадий роста</dt>
                        <dd>{g.stages}</dd>
                      </div>
                    )}
                  </dl>
                </section>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
