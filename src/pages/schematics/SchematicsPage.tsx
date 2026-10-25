import { useMemo, useRef, useState } from 'react';
import { isBlock, useItems } from '@/shared/pack-data';
import { ApplyFavoritesDialog, FavoritesPanel, SmartAddDialog, type Pair, type PlanRow } from './ui/SchematicFavorites';
import { replaceFavoritesStore } from '@/entities/schematic';
import { useFavorites } from './model/replaceFavorites';
import { SchematicLayers } from './ui/SchematicLayers';
import { SchematicLibrary } from './ui/SchematicLibrary';
import { useNick } from '@/entities/user';
import { filesEnabled } from '@/entities/file';
import { geminiEnabled } from '@/shared/api';
import { agentReplace, applyRules, loadSchematic, REMOVE, type Rule, type Schematic } from '@/lib/schematic';
import { aggregateBlocks, visibleBlocks } from './model/visibleBlocks';
import { replaceSig, type SmartResult } from './model/schematicFormat';
import { useSchematicActions } from './model/useSchematicActions';
import {
  AGENT_KEY,
  DEFAULT_AGENT,
  PANEL_KEY,
  loadPref,
  loadRules,
  savePref,
  saveRules,
  type AgentPrefs,
  type ToolPanel,
} from './model/schematicPrefs';
import { SchematicsBlockList } from './ui/SchematicsBlockList';
import { SchematicsDropzone } from './ui/SchematicsDropzone';
import { SchematicsFileList } from './ui/SchematicsFileList';
import { SchematicsHeader } from './ui/SchematicsHeader';
import { SchematicsSmartPanel } from './ui/SchematicsSmartPanel';
import { SchematicsToolbar } from './ui/SchematicsToolbar';
import { cx } from '@/shared/lib';
import styles from './SchematicsPage.module.css';

export function SchematicsPage() {
  const items = useItems();
  const nick = useNick();
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
  const [agentPrefs, setAgentPrefs] = useState(() => loadPref<AgentPrefs>(AGENT_KEY, DEFAULT_AGENT));
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
  const { downloadSchematic, save } = useSchematicActions({
    items,
    nick,
    replace,
    setSchematics,
    setSaving,
    setSavedSig,
    setExportError,
  });

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

  /** Все блоки всех загруженных схем и строки списка с фильтром */
  const blocks = useMemo(() => aggregateBlocks(schematics), [schematics]);
  const shown = useMemo(() => visibleBlocks(blocks, filter, replace, items), [blocks, filter, replace, items]);

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

  const setShape = (key: string, patch: Partial<Schematic['shape']>) =>
    setSchematics((list) => list.map((x) => (x.key === key ? { ...x, shape: { ...x.shape, ...patch } } : x)));

  /** Схема из библиотеки — в редактор вместе с её заменами */
  const openSaved = (s: Schematic, rep: Map<string, string>) => {
    setSchematics((list) => [...list.filter((x) => x.key !== s.key), s]);
    setReplace((m) => new Map([...m, ...rep]));
    setSavedSig((m) => ({ ...m, [s.key]: replaceSig(s, rep) }));
  };

  /** Звезда у замены: убрать из избранного или открыть «в избранное» с умным дополнением */
  const toggleFavorite = (id: string, to: string) => {
    const fav = favorites?.find((f) => f.from === id && f.to === to);
    if (fav) replaceFavoritesStore.remove(fav.id);
    else setSmartFor({ from: id, to });
  };

  return (
    <div
      className={cx(styles.page, dragging && styles.dragging)}
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
      <SchematicsHeader inputRef={inputRef} onFiles={addFiles} />

      {loadErrors.length > 0 && (
        <div className="error-box">
          {loadErrors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}

      {exportError && <div className="error-box">{exportError}</div>}

      {schematics.length === 0 ? (
        <SchematicsDropzone onClick={() => inputRef.current?.click()} />
      ) : (
        <>
          <SchematicsFileList
            schematics={schematics}
            replace={replace}
            items={items}
            shapeOpen={shapeOpen}
            saving={saving}
            savedSig={savedSig}
            pickingPlatform={pickingPlatform}
            onRemove={(key) => setSchematics((l) => l.filter((x) => x.key !== key))}
            onToggleShape={toggleShape}
            onOpenLayers={setLayersFor}
            onDownload={downloadSchematic}
            onSave={save}
            onSetShape={setShape}
            onPickPlatform={setPickingPlatform}
          />

          <div className={styles.work}>
            <SchematicsToolbar
              panel={panel}
              onTogglePanel={togglePanel}
              useAgent={useAgent}
              progress={progress}
              result={result}
              favorites={favorites}
              favPlanCount={favPlan.length}
              filter={filter}
              onFilter={setFilter}
              replacedTypes={replacedTypes}
              blocksCount={blocks.length}
              replaceCount={replace.size}
              canApply={!!items && (useAgent || rules.some((r) => r.from.trim()))}
              onRunSmart={runSmart}
              onOpenApplyFavs={() => setApplyFavsOpen(true)}
              onReset={() => (setReplace(new Map()), setReasons(new Map()), setAlts(new Map()))}
            />

            {panel === 'smart' && (
              <SchematicsSmartPanel
                useAgent={useAgent}
                geminiEnabled={geminiEnabled}
                agentPrefs={agentPrefs}
                onAgent={updateAgent}
                rules={rules}
                onRules={updateRules}
                overwrite={overwrite}
                onOverwrite={setOverwrite}
                result={result}
              />
            )}

            {panel === 'favs' && favorites && <FavoritesPanel favorites={favorites} items={items} />}

            <SchematicsBlockList
              shown={shown}
              replace={replace}
              items={items}
              picking={picking}
              reasons={reasons}
              alts={alts}
              favorites={favorites}
              onPick={setPicking}
              onTarget={setTarget}
              onSwapAlt={swapAlt}
              onToggleFavorite={toggleFavorite}
            />
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
