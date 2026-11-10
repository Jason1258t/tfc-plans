import { ArrowUpRight, Search as SearchIcon } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { subscribeGuidesExcept } from '@/data/guides';
import type { Guide } from '@/entities/guide';
import { BASE_DOCS, BASE_VALUES } from '@/lib/guideScope';
import { PUMP_IMPACT_KEY, usePower, useSettings, type PowerData } from '@/lib/power';
import { powerScope } from '@/lib/powerGuideScope';
import { IeLoadPicker, MultiblockEmbed } from '@/features/reference-tabs';
import { Search, SectionShell, Select, contentStyles as content } from '@/shared/ui';
import type { GuideKit } from './GuideBody';
import { guideSection, OFF_CATALOG_SECTIONS } from './guideMeta';
import { GuideScreens } from './GuidesSection';
import { POWER_WIDGETS } from './powerWidgets';
import styles from './Guides.module.css';

/**
 * Справочник → «Гайды»: все статьи, кроме аддонных. Разделы и группы берутся из самих гайдов (section, group),
 * названия и порядок разделов — guideMeta. Отдельный чанк (lazy в GuidesTab): формулы, YAML и редактор грузятся,
 * только когда открывают гайды.
 */

export interface CatalogPlace {
  section: string | null;
  guide: string | null;
}

interface Props extends CatalogPlace {
  onPlace: (p: CatalogPlace) => void;
}

/** Виджет структуры мультиблока — для гайдов любого раздела */
const MULTIBLOCK_WIDGET: GuideKit['widgets'] = {
  multiblock: {
    doc: 'структура мультиблока: id=crusher (имя из адреса вкладки «Мультиблоки»); full — целиком, как в книге (экскаватор); materials — с таблицей материалов',
    render: ({ params }) => (
      <MultiblockEmbed
        id={String(params.id ?? '')}
        full={Boolean(params.full)}
        withMaterials={Boolean(params.materials)}
      />
    ),
  },
};

const BASE_KIT: GuideKit = { scope: { values: BASE_VALUES, docs: BASE_DOCS }, widgets: MULTIBLOCK_WIDGET };

export default function GuidesCatalog(props: Props) {
  const data = usePower();
  if (data === undefined) return <div className="empty">Загружаю гайды…</div>;
  return data ? <PowerCatalog data={data} {...props} /> : <Catalog kit={BASE_KIT} {...props} />;
}

/** Формулам гайдов нужны настройки модов — как во вкладке «Электричество»; имена доступны во всех разделах */
function PowerCatalog({ data, ...props }: Props & { data: PowerData }) {
  const ee = useSettings(data.ee?.file, data.ee?.keys);
  const ie = useSettings(data.ie?.file, data.ie?.keys);
  const att = useSettings(data.att?.file, data.att?.keys);
  const create = useSettings(data.create?.file, [{ key: PUMP_IMPACT_KEY, default: data.create?.pumpImpact ?? null }]);
  const rate = ee.get('wattFeTConversionRate')?.value ?? null;
  // Геттеры настроек новые на каждый показ — ключ из значений, чтобы не пересчитывать статью зря
  const fingerprint = JSON.stringify([
    data.ee?.keys?.map((k) => ee.get(k.key)?.value),
    data.ie?.keys?.map((k) => ie.get(k.key)?.value),
    data.att?.keys?.map((k) => att.get(k.key)?.value),
    create.get(PUMP_IMPACT_KEY)?.value,
  ]);
  const kit = useMemo<GuideKit>(
    () => ({
      scope: powerScope(data, { ee: ee.get, ie: ie.get, att: att.get, create: create.get }),
      widgets: { ...POWER_WIDGETS, ...MULTIBLOCK_WIDGET },
      pickers: {
        'ie-loads': {
          label: 'из машин IE…',
          render: (onApply) => <IeLoadPicker data={data} ie={ie.get} att={att.get} rate={rate} onApply={onApply} />,
        },
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, fingerprint],
  );
  return <Catalog kit={kit} {...props} />;
}

const byOrder = (a: Guide, b: Guide) => a.order - b.order || a.title.localeCompare(b.title, 'ru');
const lower = (s: string) => s.toLowerCase().replaceAll('ё', 'е');

function Catalog({ kit, section: wanted, guide, onPlace }: Props & { kit: GuideKit }) {
  const navigate = useNavigate();
  const [guides, setGuides] = useState<Guide[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  /** Группа, к которой прокрутить список, когда он покажется (щелчок в меню из статьи) */
  const jump = useRef<string | null>(null);

  useEffect(
    () =>
      subscribeGuidesExcept(OFF_CATALOG_SECTIONS, setGuides, (e) => {
        setError(e.message);
        setGuides([]);
      }),
    [],
  );

  const sections = useMemo(() => {
    const count = new Map<string, number>();
    for (const g of guides ?? []) count.set(g.section, (count.get(g.section) ?? 0) + (g.hidden ? 0 : 1));
    return [...count]
      .map(([id, n]) => ({ ...guideSection(id), count: n }))
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'ru'));
  }, [guides]);

  // Открытая статья задаёт раздел сама: старые ссылки ?sub=… без нового раздела ведут куда надо
  const opened = guide ? guides?.find((g) => g.id === guide) : undefined;
  const current =
    opened?.section ?? (sections.some((s) => s.id === wanted) ? wanted! : (sections[0]?.id ?? wanted ?? 'power'));
  const meta = guideSection(current);
  const q = lower(query.trim());

  const list = useMemo(() => {
    if (!guides) return null;
    if (!q) return guides.filter((g) => g.section === current);
    return guides
      .filter((g) => lower(`${g.title} ${g.summary} ${g.group} ${g.id}`).includes(q))
      .sort((a, b) => guideSection(a.section).order - guideSection(b.section).order || byOrder(a, b));
  }, [guides, current, q]);

  // Группы раздела в порядке списка — подпункты меню
  const groups = useMemo(() => {
    const out: string[] = [];
    for (const g of [...(guides ?? [])].filter((x) => x.section === current && !x.hidden).sort(byOrder)) {
      const name = g.group || 'Разное';
      if (!out.includes(name)) out.push(name);
    }
    return out;
  }, [guides, current]);

  const scrollToGroup = (name: string) =>
    document.querySelector(`[data-group="${CSS.escape(name)}"]`)?.scrollIntoView();
  useEffect(() => {
    if (!jump.current || guide || !list) return;
    scrollToGroup(jump.current);
    jump.current = null;
  }, [guide, list]);

  const openSection = (id: string) => {
    setQuery('');
    onPlace({ section: id, guide: null });
    window.scrollTo({ top: 0 });
  };
  const openGroup = (name: string) => {
    if (guide || q) {
      jump.current = name;
      setQuery('');
      onPlace({ section: current, guide: null });
    } else scrollToGroup(name);
  };
  const openGuide = (id: string | null) =>
    onPlace({ section: (id && guides?.find((g) => g.id === id)?.section) || current, guide: id });

  return (
    <SectionShell
      navLabel="Разделы гайдов"
      nav={
        <>
          <Search className={styles.catalogSearch}>
            <SearchIcon size={15} className="faint" aria-hidden />
            <input
              aria-label="Поиск по гайдам"
              placeholder="Найти гайд…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (guide) onPlace({ section: current, guide: null });
              }}
            />
          </Search>
          <Select
            className={styles.catalogSelect}
            aria-label="Раздел гайдов"
            value={current}
            onChange={(e) =>
              e.target.value === 'addons' ? navigate('/addons?sub=guides') : openSection(e.target.value)
            }
          >
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} ({s.count})
              </option>
            ))}
            <option value="addons">Свой аддон →</option>
          </Select>
          <div className={styles.catalogTree}>
            {sections.map((s) => (
              <Fragment key={s.id}>
                <button aria-pressed={s.id === current && !q} onClick={() => openSection(s.id)}>
                  <span>{s.label}</span>
                  <span className="faint small">{s.count}</span>
                </button>
                {s.id === current && !q && groups.length > 1 && (
                  <div className={styles.catalogGroups}>
                    {groups.map((name) => (
                      <button key={name} className="small" onClick={() => openGroup(name)}>
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </Fragment>
            ))}
            <Link to="/addons?sub=guides" className={styles.catalogLink}>
              Свой аддон <ArrowUpRight size={14} aria-hidden />
            </Link>
          </div>
        </>
      }
    >
      <div className={content.stack}>
        <GuideScreens
          all={guides}
          list={list}
          error={error}
          section={current}
          sections={sections}
          kit={kit}
          guide={guide}
          onGuide={openGuide}
          title={q ? `Найдено: ${list?.filter((g) => !g.hidden).length ?? 0}` : meta.label}
          intro={q ? undefined : meta.intro}
          checks={(g) => guideSection(g.section).checks}
          groupOf={q ? (g) => guideSection(g.section).label : undefined}
        />
      </div>
    </SectionShell>
  );
}
