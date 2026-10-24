import {
  ArrowRight,
  BookmarkPlus,
  Box,
  Check,
  ChevronDown,
  Download,
  FileBox,
  Plus,
  RotateCcw,
  Ruler,
  Search,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { ItemIcon } from '../components/ItemIcon';
import { ItemPicker } from '../components/ItemPicker';
import {
  ApplyFavoritesDialog,
  FavoritesPanel,
  SmartAddDialog,
  type Pair,
  type PlanRow,
} from '../components/SchematicFavorites';
import { replaceFavoritesStore } from '@/entities/schematic';
import { useFavorites } from '../lib/replaceFavorites';
import { SchematicLayers } from '../components/SchematicLayers';
import { SchematicLibrary } from '../components/SchematicLibrary';
import { useData } from '../data/DataContext';
import { filesEnabled, formatSize } from '../lib/files';
import { geminiEnabled } from '../lib/gemini';
import { blockEntry, inPack, isBlock, itemName, useItems } from '../lib/items';
import {
  applyRules,
  changesIn,
  EMPTY_BLOCKS,
  shapedSize,
  exportSchematic,
  invalidTargets,
  loadSchematic,
  REMOVE,
  agentReplace,
  type AgentResult,
  type Rule,
  type RuleResult,
  type Schematic,
} from '../lib/schematic';
import { makePreview, saveToLibrary } from '../lib/schematicLibrary';
import { cx } from '@/shared/lib';
import './SchematicsPage.css';

const RULES_KEY = 'tfc-tm:schematic-rules';
const DEFAULT_RULES: Rule[] = [
  { from: 'minecraft:', to: 'tfc:' },
  { from: 'oak', to: 'eucalyptus' },
];

const AGENT_KEY = 'tfc-tm:schematic-agent';
/** Какая панель инструментов открыта: умная замена, избранное или ни одной */
const PANEL_KEY = 'tfc-tm:schematic-panel';
type ToolPanel = 'smart' | 'favs' | null;

function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function savePref(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* не запомним — не страшно */
  }
}

type SmartResult = ({ kind: 'rules' } & RuleResult) | ({ kind: 'agent' } & AgentResult);

function loadRules(): Rule[] {
  try {
    const r = JSON.parse(localStorage.getItem(RULES_KEY) ?? 'null');
    return Array.isArray(r) && r.length ? r : DEFAULT_RULES;
  } catch {
    return DEFAULT_RULES;
  }
}

function saveRules(rules: Rule[]) {
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(rules));
  } catch {
    /* не запомним — не страшно */
  }
}

function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const outName = (name: string) => name.replace(/(\.nbt)?$/i, '_tfc.nbt');

/** Отпечаток замен одной схемы — понять, отличаются ли они от сохранённых в библиотеке */
const replaceSig = (s: Schematic, replace: Map<string, string>) =>
  JSON.stringify([[...replace].filter(([from]) => s.counts.has(from)).sort(), s.shape, s.rev]);

/** Коротко о форме схемы — для свёрнутой строки файла */
const shapeSummary = (sh: Schematic['shape']) =>
  [
    sh.crop && `обрезка ${sh.sides}/${sh.bottom}/${sh.top}`,
    sh.platform && `площадка ${sh.platformHeight}${sh.platformHollow ? ', пустая' : ''}`,
    sh.clearAir && 'очистка',
  ]
    .filter(Boolean)
    .join(' · ');

const clampPad = (v: string) => Math.min(64, Math.max(0, Math.floor(Number(v)) || 0));

/** Мод предмета — у одноимённых предметов (TFC и ванильный «Медный люк») различается только он */
const modOf = (id: string) => id.split(':')[0];

export function SchematicsPage() {
  const items = useItems();
  const { nick } = useData();
  /** key схемы → идёт сохранение в библиотеку / текст ошибки */
  const [saving, setSaving] = useState<Record<string, 'saving' | string>>({});
  /** key схемы → замены на момент сохранения (галочка, пока их не меняли) */
  const [savedSig, setSavedSig] = useState<Record<string, string>>({});
  const [schematics, setSchematics] = useState<Schematic[]>([]);
  const [replace, setReplace] = useState<Map<string, string>>(new Map());
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [exportError, setExportError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState('');
  const [picking, setPicking] = useState<string | null>(null);
  /** key схемы, у которой выбирают материал площадки */
  const favorites = useFavorites();
  /** Пара, для которой открыто «добавить в избранное» с умным дополнением */
  const [smartFor, setSmartFor] = useState<Pair | null>(null);
  const [applyFavsOpen, setApplyFavsOpen] = useState(false);
  const [pickingPlatform, setPickingPlatform] = useState<string | null>(null);
  /** key схемы, открытой в редакторе слоёв */
  const [layersFor, setLayersFor] = useState<string | null>(null);
  const [rules, setRules] = useState<Rule[]>(loadRules);
  const [overwrite, setOverwrite] = useState(false);
  const [result, setResult] = useState<SmartResult | null>(null);
  const [panel, setPanel] = useState<ToolPanel>(() => loadPref<ToolPanel>(PANEL_KEY, null));
  const togglePanel = (p: Exclude<ToolPanel, null>) => {
    const next = panel === p ? null : p;
    setPanel(next);
    savePref(PANEL_KEY, next);
  };
  /** Схемы, у которых развёрнуты настройки формы */
  const [shapeOpen, setShapeOpen] = useState<Set<string>>(new Set());
  const toggleShape = (key: string) =>
    setShapeOpen((set) => {
      const next = new Set(set);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const [agentPrefs, setAgentPrefs] = useState(() =>
    loadPref(AGENT_KEY, { enabled: true, hint: 'ванильные материалы → аналоги TerraFirmaCraft' }),
  );
  const useAgent = geminiEnabled && agentPrefs.enabled;
  const [progress, setProgress] = useState<[number, number] | null>(null);
  /** Пояснения агента к выбранным им заменам */
  const [reasons, setReasons] = useState<Map<string, string>>(new Map());
  /** Запасные варианты агента: переключение в один клик */
  const [alts, setAlts] = useState<Map<string, string[]>>(new Map());
  /** Выбрать запасной вариант: текущая замена уходит в запасные */
  const swapAlt = (id: string, alt: string) => {
    const current = replace.get(id);
    setReplace((m) => new Map(m).set(id, alt));
    setAlts((m) => new Map(m).set(id, [...(current ? [current] : []), ...(m.get(id) ?? []).filter((x) => x !== alt)]));
  };
  const updateAgent = (patch: Partial<typeof agentPrefs>) => {
    const next = { ...agentPrefs, ...patch };
    setAgentPrefs(next);
    savePref(AGENT_KEY, next);
  };
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = async (files: File[]) => {
    const errors: string[] = [];
    const loaded: Schematic[] = [];
    for (const f of files) {
      try {
        loaded.push(await loadSchematic(f));
      } catch (e) {
        errors.push(`${f.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    setLoadErrors(errors);
    setSchematics((list) => [...list, ...loaded.filter((s) => !list.some((x) => x.key === s.key))]);
  };

  /** Все блоки всех загруженных схем */
  const blocks = useMemo(() => {
    const total = new Map<string, number>();
    for (const s of schematics) for (const [id, n] of s.counts) total.set(id, (total.get(id) ?? 0) + n);
    return [...total]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  }, [schematics]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    // Нераспознанные без замены (кроме воздуха) — наверх, их надо разобрать; удалённые — в конец, чтобы не мешались
    const rank = (id: string) => {
      const to = replace.get(id);
      if (to === REMOVE) return 2;
      return !to && items && !inPack(items, id) && !EMPTY_BLOCKS.has(id) ? 0 : 1;
    };
    const ordered = (list: typeof blocks) => [0, 1, 2].flatMap((r) => list.filter(({ id }) => rank(id) === r));
    if (!q) return ordered(blocks);
    return ordered(blocks).filter(({ id }) => {
      const to = replace.get(id);
      const hay = [
        id,
        itemName(blockEntry(items, id), ''),
        to === REMOVE ? 'удалён' : (to ?? ''),
        to && to !== REMOVE ? itemName(blockEntry(items, to), '') : '',
      ];
      return hay.join(' ').toLowerCase().includes(q);
    });
  }, [blocks, filter, replace, items]);

  const setTarget = (id: string, to: string | null) => {
    // В схему пишем только id из библиотеки сборки (или удаление)
    if (to && to !== REMOVE && !isBlock(items, to)) return;
    const drop = (m: Map<string, unknown>) => {
      if (!m.has(id)) return m;
      const next = new Map(m);
      next.delete(id);
      return next;
    };
    setReasons((m) => drop(m) as Map<string, string>);
    setAlts((m) => drop(m) as Map<string, string[]>);
    setReplace((m) => {
      const next = new Map(m);
      if (to && to !== id) next.set(id, to);
      else next.delete(id);
      return next;
    });
  };

  /** Пакетно записать замены (из избранного); цели вне библиотеки сборки пропускаются */
  const applyPairs = (pairs: Pair[]) => {
    const ok = pairs.filter((p) => p.to !== p.from && isBlock(items, p.to));
    if (!ok.length) return;
    const ids = new Set(ok.map((p) => p.from));
    const drop = (m: Map<string, unknown>) => new Map([...m].filter(([k]) => !ids.has(k)));
    setReasons((m) => drop(m) as Map<string, string>);
    setAlts((m) => drop(m) as Map<string, string[]>);
    setReplace((m) => new Map([...m, ...ok.map((p) => [p.from, p.to] as const)]));
  };

  const updateRules = (next: Rule[]) => {
    setRules(next);
    saveRules(next);
  };

  const runSmart = async () => {
    if (!items || progress) return;
    const ids = blocks.map((b) => b.id).filter((id) => overwrite || !replace.has(id));
    if (!useAgent) {
      const r = applyRules(ids, rules, items);
      setReplace((m) => new Map([...m, ...r.applied]));
      setResult({ kind: 'rules', ...r });
      return;
    }
    setResult(null);
    setProgress([0, ids.length]);
    try {
      const r = await agentReplace(ids, rules, agentPrefs.hint, items, (done, total) => setProgress([done, total]));
      setReplace((m) => new Map([...m, ...r.applied]));
      setReasons((m) => new Map([...m, ...r.reasons]));
      setAlts((m) => new Map([...m, ...r.alternatives]));
      setResult({ kind: 'agent', ...r });
    } finally {
      setProgress(null);
    }
  };

  /** Умная замена для редактора слоёв (выделенные блоки): те же правила или агент, без записи в общие замены */
  const smartTargets = async (ids: string[]) => {
    if (!items) return new Map<string, string>();
    if (!useAgent) return applyRules(ids, rules, items).applied;
    return (await agentReplace(ids, rules, agentPrefs.hint, items, () => {})).applied;
  };

  /** Что можно подставить из избранного: блоки без замены, у которых есть избранные цели из сборки */
  const favPlan = useMemo<PlanRow[]>(() => {
    if (!items || !favorites?.length) return [];
    const by = new Map<string, string[]>();
    for (const f of favorites) {
      if (!isBlock(items, f.to)) continue;
      const list = by.get(f.from) ?? [];
      if (!list.includes(f.to)) list.push(f.to);
      by.set(f.from, list);
    }
    return blocks
      .filter((b) => !replace.has(b.id) && by.has(b.id))
      .map((b) => ({ from: b.id, count: b.count, options: by.get(b.id)! }));
  }, [items, favorites, blocks, replace]);
  const presentIds = useMemo(() => new Set(blocks.map((b) => b.id)), [blocks]);

  const replacedTypes = blocks.filter((b) => replace.has(b.id)).length;

  const downloadSchematic = async (s: Schematic, rep = replace) => {
    if (!items) return;
    const bad = invalidTargets(rep, items).filter((b) => s.counts.has(b.from));
    if (bad.length) {
      setExportError(
        `Не скачано: замены на то, что не ставится блоком (нет в сборке или это только предмет) — ${bad.map((b) => `${b.from} → ${b.to}`).join(', ')}`,
      );
      return;
    }
    if (s.shape.platform && !isBlock(items, s.shape.platformBlock)) {
      setExportError(`Не скачано: материала площадки ${s.shape.platformBlock} нет в сборке — выберите другой`);
      return;
    }
    setExportError(null);
    try {
      download(await exportSchematic(s, rep), outName(s.fileName));
    } catch (e) {
      setExportError(`Не скачано: ${e instanceof Error ? e.message : e}`);
    }
  };

  const setShape = (key: string, patch: Partial<Schematic['shape']>) =>
    setSchematics((list) => list.map((x) => (x.key === key ? { ...x, shape: { ...x.shape, ...patch } } : x)));

  const save = async (s: Schematic) => {
    setSaving((m) => ({ ...m, [s.key]: 'saving' }));
    try {
      // Превью — с заменами, как схема будет выглядеть после скачивания
      const preview = items ? await makePreview(s, replace, items) : null;
      const { id, fileId } = await saveToLibrary(s, replace, nick, preview);
      setSchematics((list) =>
        list.map((x) =>
          x.key === s.key ? { ...x, libraryId: id, libraryFileId: fileId ?? x.libraryFileId, savedRev: s.rev } : x,
        ),
      );
      setSavedSig((m) => ({ ...m, [s.key]: replaceSig(s, replace) }));
      setSaving((m) => {
        const next = { ...m };
        delete next[s.key];
        return next;
      });
    } catch (e) {
      setSaving((m) => ({ ...m, [s.key]: `Не сохранено: ${e instanceof Error ? e.message : e}` }));
    }
  };

  /** Схема из библиотеки — в редактор вместе с её заменами */
  const openSaved = (s: Schematic, rep: Map<string, string>) => {
    setSchematics((list) => [...list.filter((x) => x.key !== s.key), s]);
    setReplace((m) => new Map([...m, ...rep]));
    setSavedSig((m) => ({ ...m, [s.key]: replaceSig(s, rep) }));
  };

  return (
    <div
      className={cx('schem-page', dragging && 'dragging')}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles([...e.dataTransfer.files]);
      }}
    >
      <div className="schem-head">
        <div className="grow">
          <h1>Замена блоков в схемах</h1>
          <p className="muted">
            Схемы Create (.nbt) для принтера: замените блоки на те, что есть в сборке. Всё происходит в браузере — файлы
            никуда не загружаются.
          </p>
        </div>
        <button className="btn primary" onClick={() => inputRef.current?.click()}>
          <Upload size={16} />
          Открыть .nbt
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".nbt"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles([...e.target.files]);
            e.target.value = '';
          }}
        />
      </div>

      {loadErrors.length > 0 && (
        <div className="error-box">
          {loadErrors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}

      {exportError && <div className="error-box">{exportError}</div>}

      {schematics.length === 0 ? (
        <button className="schem-drop" onClick={() => inputRef.current?.click()}>
          <FileBox size={32} />
          <span>Перетащите сюда .nbt-схемы или нажмите, чтобы выбрать</span>
          <span className="faint small">Можно несколько файлов сразу — замены применятся ко всем</span>
        </button>
      ) : (
        <>
          <ul className="schem-files">
            {schematics.map((s) => {
              const ch = changesIn(s, replace);
              const shaped = shapedSize(s, replace);
              return (
                <li key={s.key} className="schem-file">
                  <FileBox size={18} className="faint" />
                  <span className="grow">
                    <span className="schem-file-name">{s.fileName}</span>
                    <span className="faint small">
                      {formatSize(s.fileSize)}
                      {s.size && ` · ${s.size.join('×')}`}
                      {shaped && ` → ${shaped.join('×')}`} · {s.counts.size} типов блоков
                      {ch.types > 0 && ` · изменено ${ch.types} (${ch.blocks} шт.)`}
                      {ch.removed > 0 && ` · удаляется ${ch.removed} шт.`}
                      {s.rev !== (s.savedRev ?? 0) && ' · правки по слоям'}
                    </span>
                  </span>
                  <button
                    className="btn ghost sm icon"
                    onClick={() => setSchematics((l) => l.filter((x) => x.key !== s.key))}
                    aria-label={`Убрать ${s.fileName}`}
                  >
                    <X size={15} />
                  </button>
                  <div className="schem-file-tools">
                    <button
                      className={cx('btn sm', shapeOpen.has(s.key) && 'active')}
                      onClick={() => toggleShape(s.key)}
                      aria-expanded={shapeOpen.has(s.key)}
                      title="Обрезка краёв, отступы, площадка под схемой, очистка пространства"
                    >
                      <Ruler size={14} />
                      Форма
                      {shapeSummary(s.shape) && <span className="faint">: {shapeSummary(s.shape)}</span>}
                      <ChevronDown size={13} className={cx('chev', shapeOpen.has(s.key) && 'open')} />
                    </button>
                    <button
                      className="btn sm"
                      onClick={() => setLayersFor(s.key)}
                      title="Схема в 3D; там же — вид сверху по слоям: посмотреть блоки, убрать или заменить отдельные"
                    >
                      <Box size={14} />
                      3D
                    </button>
                    <button
                      className="btn sm"
                      onClick={() => downloadSchematic(s)}
                      disabled={!items}
                      title={`Скачать как ${outName(s.fileName)}`}
                    >
                      <Download size={14} />
                      Скачать
                    </button>
                    {filesEnabled && (
                      <button
                        className="btn sm"
                        onClick={() => save(s)}
                        disabled={saving[s.key] === 'saving'}
                        title={
                          s.libraryId
                            ? 'Записать текущие замены в библиотеку'
                            : 'Сохранить схему с заменами в общую библиотеку'
                        }
                      >
                        {s.libraryId && savedSig[s.key] === replaceSig(s, replace) ? (
                          <Check size={14} />
                        ) : (
                          <BookmarkPlus size={14} />
                        )}
                        {saving[s.key] === 'saving'
                          ? 'Сохраняю…'
                          : s.libraryId
                            ? 'Обновить в библиотеке'
                            : 'В библиотеку'}
                      </button>
                    )}
                    {saving[s.key] && saving[s.key] !== 'saving' && (
                      <span className="schem-save-error small">{saving[s.key]}</span>
                    )}
                  </div>
                  {shapeOpen.has(s.key) && (
                    <div className="schem-shape">
                      <label
                        className="toggle sm-toggle"
                        title="Убрать пустое место по краям: габарит — по крайним блокам, воздух не считается"
                      >
                        <input
                          type="checkbox"
                          checked={s.shape.crop}
                          onChange={(e) => setShape(s.key, { crop: e.target.checked })}
                        />
                        Обрезать края
                      </label>
                      {(
                        [
                          ['sides', 'по бокам'],
                          ['bottom', 'снизу'],
                          ['top', 'сверху'],
                        ] as const
                      ).map(([k, label]) => (
                        <label key={k} className="schem-pad small">
                          <span className="faint">Отступ {label}</span>
                          <input
                            type="number"
                            min={0}
                            max={64}
                            value={s.shape[k]}
                            disabled={!s.shape.crop}
                            onChange={(e) => setShape(s.key, { [k]: clampPad(e.target.value) })}
                          />
                        </label>
                      ))}
                      <label className="toggle sm-toggle" title="Слои блока под всей схемой, ниже нижнего отступа">
                        <input
                          type="checkbox"
                          checked={s.shape.platform}
                          onChange={(e) => setShape(s.key, { platform: e.target.checked })}
                        />
                        Площадка
                      </label>
                      {s.shape.platform && (
                        <>
                          <label className="schem-pad small">
                            <span className="faint">Высота</span>
                            <input
                              type="number"
                              min={1}
                              max={32}
                              value={s.shape.platformHeight}
                              onChange={(e) =>
                                setShape(s.key, {
                                  platformHeight: Math.min(32, Math.max(1, Math.floor(Number(e.target.value)) || 1)),
                                })
                              }
                            />
                          </label>
                          {pickingPlatform === s.key ? (
                            <span className="schem-platform-pick">
                              <ItemPicker
                                small
                                blocksOnly
                                autoFocus
                                placeholder="Материал площадки…"
                                onPick={(it) => {
                                  setShape(s.key, { platformBlock: it.i });
                                  setPickingPlatform(null);
                                }}
                              />
                              <button
                                className="btn ghost sm icon"
                                onClick={() => setPickingPlatform(null)}
                                aria-label="Отмена"
                              >
                                <X size={15} />
                              </button>
                            </span>
                          ) : (
                            <button
                              className="btn sm"
                              onClick={() => setPickingPlatform(s.key)}
                              title={s.shape.platformBlock}
                            >
                              <ItemIcon id={s.shape.platformBlock} size={18} tip={false} />
                              {itemName(items?.byId.get(s.shape.platformBlock), s.shape.platformBlock)}
                            </button>
                          )}
                          <label
                            className="toggle sm-toggle"
                            title="При высоте больше 1: сплошной только верхний слой, ниже — стенки по периметру, пустота внутри и без дна"
                          >
                            <input
                              type="checkbox"
                              checked={s.shape.platformHollow}
                              onChange={(e) => setShape(s.key, { platformHollow: e.target.checked })}
                            />
                            Пустая
                          </label>
                        </>
                      )}
                      <label
                        className="toggle sm-toggle"
                        title="Записать воздух во все свободные клетки итогового объёма (и в отступы), чтобы при вставке схема расчищала место, а не оставляла то, что там было"
                      >
                        <input
                          type="checkbox"
                          checked={s.shape.clearAir}
                          onChange={(e) => setShape(s.key, { clearAir: e.target.checked })}
                        />
                        Очистить пространство
                      </label>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="schem-work">
            <div className="schem-toolbar">
              <span className="tool-split">
                <button
                  className={cx('btn sm', panel === 'smart' && 'active')}
                  onClick={() => togglePanel('smart')}
                  aria-expanded={panel === 'smart'}
                  title="Правила замены и агент Gemini"
                >
                  <Wand2 size={14} className="ai-ico" />
                  Умная замена
                  <ChevronDown size={13} className={cx('chev', panel === 'smart' && 'open')} />
                </button>
                <button
                  className={cx('btn sm primary', useAgent && 'agent-run')}
                  onClick={runSmart}
                  disabled={!items || !!progress || (!useAgent && !rules.some((r) => r.from.trim()))}
                  title={
                    useAgent
                      ? 'Подобрать замены агентом Gemini (настройки — «Умная замена»)'
                      : 'Применить правила замены (настройки — «Умная замена»)'
                  }
                >
                  {useAgent ? <Sparkles size={14} /> : <Wand2 size={14} />}
                  {progress ? `Агент думает… ${progress[0]}/${progress[1]}` : 'Применить'}
                </button>
              </span>
              {result && panel !== 'smart' && (
                <button className="btn ghost sm" onClick={() => togglePanel('smart')} title="Показать подробности">
                  заменено {result.applied.size}
                  {result.failed.length > 0 && <span className="bad-count">· не удалось {result.failed.length}</span>}
                </button>
              )}
              {favorites && (
                <span className="tool-split">
                  <button
                    className={cx('btn sm', panel === 'favs' && 'active')}
                    onClick={() => togglePanel('favs')}
                    aria-expanded={panel === 'favs'}
                    title="Избранные замены — общие для всех схем"
                  >
                    <Star size={14} className="fav-star on" />
                    Избранное
                    <span className="faint">{favorites.length}</span>
                    <ChevronDown size={13} className={cx('chev', panel === 'favs' && 'open')} />
                  </button>
                  <button
                    className="btn sm"
                    disabled={favPlan.length === 0}
                    onClick={() => setApplyFavsOpen(true)}
                    title="Подставить избранные замены в блоки загруженных схем, где замены ещё нет"
                  >
                    Подставить{favPlan.length > 0 && ` (${favPlan.length})`}
                  </button>
                </span>
              )}
              <label className="search">
                <Search size={15} className="faint" />
                <input placeholder="Фильтр блоков" value={filter} onChange={(e) => setFilter(e.target.value)} />
              </label>
              <span className="faint small nowrap">
                Заменено {replacedTypes} из {blocks.length}
              </span>
              {replace.size > 0 && (
                <button
                  className="btn ghost sm"
                  onClick={() => (setReplace(new Map()), setReasons(new Map()), setAlts(new Map()))}
                >
                  <RotateCcw size={14} />
                  Сбросить все
                </button>
              )}
            </div>

            {panel === 'smart' && (
              <section className="schem-rules">
                <div className="row">
                  <p className="faint small grow" style={{ margin: 0 }}>
                    {useAgent
                      ? 'Нечёткий поиск подбирает похожие предметы сборки (с учётом правил), агент Gemini выбирает подходящий по форме и материалу.'
                      : 'Правила по очереди заменяют подстроку в id блока. Замена принимается, только если такой предмет есть в сборке.'}
                  </p>
                  {geminiEnabled && (
                    <label className="toggle sm-toggle agent-toggle">
                      <input
                        type="checkbox"
                        checked={agentPrefs.enabled}
                        onChange={(e) => updateAgent({ enabled: e.target.checked })}
                      />
                      <Sparkles size={13} />
                      Использовать агента
                    </label>
                  )}
                </div>
                {useAgent && (
                  <input
                    className="input agent-hint"
                    value={agentPrefs.hint}
                    placeholder="Пожелания агенту: «дуб → эвкалипт, камень → гранит, стекло оставить»"
                    aria-label="Пожелания агенту"
                    onChange={(e) => updateAgent({ hint: e.target.value })}
                  />
                )}
                <ul className="rules">
                  {rules.map((r, i) => (
                    <li key={i}>
                      <input
                        className="input"
                        value={r.from}
                        placeholder={useAgent ? 'подсказка: что (oak)' : 'что (oak)'}
                        aria-label="Что заменить"
                        onChange={(e) =>
                          updateRules(rules.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))
                        }
                      />
                      <ArrowRight size={14} className="faint" />
                      <input
                        className="input"
                        value={r.to}
                        placeholder="на что (spruce)"
                        aria-label="На что заменить"
                        onChange={(e) => updateRules(rules.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))}
                      />
                      <button
                        className="btn ghost sm icon"
                        onClick={() => updateRules(rules.filter((_, j) => j !== i))}
                        aria-label="Удалить правило"
                      >
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                  <li>
                    <button className="btn ghost sm" onClick={() => updateRules([...rules, { from: '', to: '' }])}>
                      <Plus size={14} />
                      Правило
                    </button>
                  </li>
                </ul>
                <label className="toggle sm-toggle" style={{ alignSelf: 'flex-start' }}>
                  <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                  Перезаписывать ручные замены
                </label>
                {result && (
                  <div className="rule-result">
                    <div>
                      Заменено типов блоков: <b>{result.applied.size}</b>
                      {result.kind === 'agent' && (
                        <span className="faint"> · запросов к агенту: {result.requests}</span>
                      )}
                      {result.kind === 'agent' && result.kept.length > 0 && (
                        <>
                          {' '}
                          · оставлено как есть: <b>{result.kept.length}</b>
                        </>
                      )}
                      {result.failed.length > 0 && (
                        <>
                          {' '}
                          · не удалось: <b className="bad-count">{result.failed.length}</b>
                        </>
                      )}
                    </div>
                    {result.failed.length > 0 && (
                      <details open={result.kind === 'agent'}>
                        <summary>
                          {result.kind === 'rules'
                            ? 'Для этих блоков не нашлось предмета в сборке'
                            : 'Не удалось подобрать замену'}
                        </summary>
                        <ul className="rule-failed">
                          {result.failed.map((f) => (
                            <li key={f.source}>
                              <code>{f.source}</code>
                              {f.target && (
                                <>
                                  {' '}
                                  → <code className="bad">{f.target}</code>
                                </>
                              )}
                              {'reason' in f && <span className="faint"> — {f.reason}</span>}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {result.kind === 'agent' && result.kept.length > 0 && (
                      <details className="kept">
                        <summary>Оставлены как есть</summary>
                        <ul className="rule-failed">
                          {result.kept.map((f) => (
                            <li key={f.source}>
                              <code>{f.source}</code>
                              <span className="faint"> — {f.reason}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
              </section>
            )}

            {panel === 'favs' && favorites && <FavoritesPanel favorites={favorites} items={items} />}

            <ul className="schem-blocks">
              {shown.map(({ id, count }) => {
                const known = blockEntry(items, id);
                const to = replace.get(id);
                return (
                  <li key={id} className={cx('schem-row', to && 'replaced', to === REMOVE && 'removed')}>
                    <div className="schem-src">
                      <ItemIcon id={id} size={28} />
                      <span className="grow schem-names">
                        <span className="schem-name">{known ? itemName(known) : id.split(':').pop()}</span>
                        <code className="schem-id">{id}</code>
                      </span>
                      {!known && <span className="tag">нет в сборке</span>}
                      <span className="schem-count">×{count}</span>
                    </div>
                    <ArrowRight size={16} className="schem-arrow" />
                    <div className="schem-dst">
                      {picking === id ? (
                        <div className="row grow">
                          <div className="grow">
                            <ItemPicker
                              small
                              blocksOnly
                              autoFocus
                              placeholder="На что заменить…"
                              onPick={(it) => {
                                setTarget(id, it.i);
                                setPicking(null);
                              }}
                            />
                          </div>
                          <button className="btn ghost sm icon" onClick={() => setPicking(null)} aria-label="Отмена">
                            <X size={15} />
                          </button>
                        </div>
                      ) : to === REMOVE ? (
                        <>
                          <span className="schem-target schem-removed">
                            <Trash2 size={18} className="faint" />
                            <span className="grow schem-names">
                              <span className="schem-name">Удалён из схемы</span>
                              <span className="faint small">принтер не будет ставить этот блок</span>
                            </span>
                          </span>
                          <button
                            className="btn ghost sm icon"
                            onClick={() => setTarget(id, null)}
                            aria-label="Вернуть блок"
                            title="Вернуть блок"
                          >
                            <X size={15} />
                          </button>
                        </>
                      ) : to ? (
                        <>
                          <button
                            className="schem-target"
                            onClick={() => setPicking(id)}
                            title={reasons.get(id) ? `Агент: ${reasons.get(id)}` : 'Выбрать другой'}
                          >
                            <ItemIcon id={to} size={28} />
                            <span className="grow schem-names">
                              <span className="schem-name">{itemName(blockEntry(items, to), to)}</span>
                              <code className="schem-id">{to}</code>
                            </span>
                            <span className={cx('tag', 'mod-tag', modOf(to) !== modOf(id) && 'mod-changed')}>
                              {modOf(to)}
                            </span>
                            {reasons.get(id) && <Sparkles size={13} className="ai-ico" aria-label="Выбрано агентом" />}
                          </button>
                          {(() => {
                            const fav = favorites?.find((f) => f.from === id && f.to === to);
                            return (
                              <button
                                className="btn ghost sm icon"
                                onClick={() =>
                                  fav ? replaceFavoritesStore.remove(fav.id) : setSmartFor({ from: id, to })
                                }
                                aria-label={fav ? 'Убрать из избранного' : 'В избранное'}
                                title={
                                  fav ? 'В избранном — нажмите, чтобы убрать' : 'В избранное (с умным дополнением)'
                                }
                              >
                                <Star size={15} className={cx('fav-star', fav && 'on')} />
                              </button>
                            );
                          })()}
                          <button
                            className="btn ghost sm icon"
                            onClick={() => setTarget(id, null)}
                            aria-label="Отменить замену"
                            title="Отменить замену"
                          >
                            <X size={15} />
                          </button>
                          {(alts.get(id)?.length ?? 0) > 0 && (
                            <div className="schem-alts">
                              <span className="faint small">ещё:</span>
                              {alts.get(id)!.map((alt) => (
                                <button
                                  key={alt}
                                  className="alt-chip"
                                  onClick={() => swapAlt(id, alt)}
                                  title={`Заменить на ${alt}`}
                                >
                                  <ItemIcon id={alt} size={16} tip={false} />
                                  <span>{itemName(blockEntry(items, alt), alt)}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          {(() => {
                            const opts = [
                              ...new Set((favorites ?? []).filter((f) => f.from === id).map((f) => f.to)),
                            ].filter((t) => isBlock(items, t));
                            return opts.length > 0 ? (
                              <span className="schem-fav-chips">
                                {opts.map((t) => (
                                  <button
                                    key={t}
                                    className="fav-chip"
                                    onClick={() => setTarget(id, t)}
                                    title={`Из избранного: ${t}`}
                                  >
                                    <Star size={12} className="fav-star on" />
                                    <ItemIcon id={t} size={18} tip={false} />
                                    <span>{itemName(blockEntry(items, t), t)}</span>
                                  </button>
                                ))}
                              </span>
                            ) : null;
                          })()}
                          <button className="btn ghost sm schem-choose" onClick={() => setPicking(id)}>
                            Выбрать замену…
                          </button>
                          <button
                            className="btn ghost sm icon"
                            onClick={() => setTarget(id, REMOVE)}
                            aria-label="Убрать блок из схемы"
                            title="Убрать блок из схемы"
                          >
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}

      {(() => {
        const s = layersFor && schematics.find((x) => x.key === layersFor);
        return s ? (
          <SchematicLayers
            schematic={s}
            replace={replace}
            onChange={(next) => setSchematics((list) => list.map((x) => (x.key === next.key ? next : x)))}
            onSetTarget={setTarget}
            favorites={favorites ?? []}
            smartTargets={smartTargets}
            onClose={() => setLayersFor(null)}
          />
        ) : null;
      })()}

      {smartFor && items && (
        <SmartAddDialog
          pair={smartFor}
          items={items}
          present={presentIds}
          replace={replace}
          favorites={favorites ?? []}
          nick={nick}
          onClose={() => setSmartFor(null)}
          onApply={applyPairs}
        />
      )}
      {applyFavsOpen && (
        <ApplyFavoritesDialog
          plan={favPlan}
          items={items}
          onClose={() => setApplyFavsOpen(false)}
          onApply={applyPairs}
        />
      )}

      {filesEnabled && (
        <SchematicLibrary
          openIds={new Set(schematics.map((s) => s.libraryId).filter((x): x is string => !!x))}
          onOpen={openSaved}
          onDownload={downloadSchematic}
        />
      )}
    </div>
  );
}
