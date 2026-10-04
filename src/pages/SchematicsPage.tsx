import { ArrowRight, Download, FileBox, Plus, RotateCcw, Search, Sparkles, Upload, Wand2, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { ItemIcon } from '../components/ItemIcon';
import { ItemPicker } from '../components/ItemPicker';
import { formatSize } from '../lib/files';
import { geminiEnabled } from '../lib/gemini';
import { itemName, useItems } from '../lib/items';
import {
  applyRules,
  changesIn,
  exportSchematic,
  loadSchematic,
  agentReplace,
  type AgentResult,
  type Rule,
  type RuleResult,
  type Schematic,
} from '../lib/schematic';
import { cx } from '../lib/util';
import './SchematicsPage.css';

const RULES_KEY = 'tfc-tm:schematic-rules';
const DEFAULT_RULES: Rule[] = [
  { from: 'minecraft:', to: 'tfc:' },
  { from: 'oak', to: 'eucalyptus' },
];

const AGENT_KEY = 'tfc-tm:schematic-agent';

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

export function SchematicsPage() {
  const items = useItems();
  const [schematics, setSchematics] = useState<Schematic[]>([]);
  const [replace, setReplace] = useState<Map<string, string>>(new Map());
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState('');
  const [picking, setPicking] = useState<string | null>(null);
  const [rules, setRules] = useState<Rule[]>(loadRules);
  const [overwrite, setOverwrite] = useState(false);
  const [result, setResult] = useState<SmartResult | null>(null);
  const [agentPrefs, setAgentPrefs] = useState(() =>
    loadPref(AGENT_KEY, { enabled: true, hint: 'ванильные материалы → аналоги TerraFirmaCraft' }),
  );
  const useAgent = geminiEnabled && agentPrefs.enabled;
  const [progress, setProgress] = useState<[number, number] | null>(null);
  /** Пояснения агента к выбранным им заменам */
  const [reasons, setReasons] = useState<Map<string, string>>(new Map());
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
    if (!q) return blocks;
    return blocks.filter(({ id }) => {
      const to = replace.get(id);
      const hay = [id, itemName(items?.byId.get(id), ''), to ?? '', to ? itemName(items?.byId.get(to), '') : ''];
      return hay.join(' ').toLowerCase().includes(q);
    });
  }, [blocks, filter, replace, items]);

  const setTarget = (id: string, to: string | null) => {
    setReasons((m) => {
      if (!m.has(id)) return m;
      const next = new Map(m);
      next.delete(id);
      return next;
    });
    setReplace((m) => {
      const next = new Map(m);
      if (to && to !== id) next.set(id, to);
      else next.delete(id);
      return next;
    });
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
      setResult({ kind: 'agent', ...r });
    } finally {
      setProgress(null);
    }
  };

  const replacedTypes = blocks.filter((b) => replace.has(b.id)).length;

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
              return (
                <li key={s.key} className="schem-file">
                  <FileBox size={18} className="faint" />
                  <span className="grow">
                    <span className="schem-file-name">{s.fileName}</span>
                    <span className="faint small">
                      {formatSize(s.fileSize)}
                      {s.size && ` · ${s.size.join('×')}`} · {s.counts.size} типов блоков
                      {ch.types > 0 && ` · заменено ${ch.types} (${ch.blocks} шт.)`}
                    </span>
                  </span>
                  <button
                    className="btn sm"
                    onClick={async () => download(await exportSchematic(s, replace), outName(s.fileName))}
                    title={`Скачать как ${outName(s.fileName)}`}
                  >
                    <Download size={14} />
                    Скачать
                  </button>
                  <button
                    className="btn ghost sm icon"
                    onClick={() => setSchematics((l) => l.filter((x) => x.key !== s.key))}
                    aria-label={`Убрать ${s.fileName}`}
                  >
                    <X size={15} />
                  </button>
                </li>
              );
            })}
          </ul>

          <section className="schem-rules">
            <div className="row">
              <Wand2 size={16} className="ai-ico" />
              <h3 className="grow">Умная замена</h3>
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
            <p className="faint small" style={{ margin: 0 }}>
              {useAgent
                ? 'Для каждого блока нечёткий поиск подбирает похожие предметы сборки (с учётом правил ниже), а агент Gemini выбирает из них подходящий по форме и материалу.'
                : 'Правила применяются по очереди к id блока как замена подстроки. Замена принимается, только если получившийся предмет есть в сборке.'}
            </p>
            {useAgent && (
              <textarea
                className="input agent-hint"
                rows={2}
                value={agentPrefs.hint}
                placeholder="Пожелания агенту: «дуб → эвкалипт, камень → гранит, стекло оставить»"
                aria-label="Пожелания агенту"
                onChange={(e) => updateAgent({ hint: e.target.value })}
              />
            )}
            <ul className="rules">
              {rules.map((r, i) => (
                <li key={i} className="row">
                  <input
                    className="input"
                    value={r.from}
                    placeholder={useAgent ? 'подсказка: что (oak)' : 'что (oak)'}
                    aria-label="Что заменить"
                    onChange={(e) => updateRules(rules.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}
                  />
                  <ArrowRight size={16} className="faint" />
                  <input
                    className="input"
                    value={r.to}
                    placeholder="на что (spruce)"
                    aria-label="На что заменить"
                    onChange={(e) => updateRules(rules.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))}
                  />
                  <button
                    className="btn ghost icon"
                    onClick={() => updateRules(rules.filter((_, j) => j !== i))}
                    aria-label="Удалить правило"
                  >
                    <X size={15} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="row wrap">
              <button className="btn sm" onClick={() => updateRules([...rules, { from: '', to: '' }])}>
                <Plus size={14} />
                Правило
              </button>
              <label className="toggle sm-toggle">
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                Перезаписывать ручные замены
              </label>
              <span className="grow" />
              <button
                className={cx('btn primary', useAgent && 'agent-run')}
                onClick={runSmart}
                disabled={!items || !!progress || (!useAgent && !rules.some((r) => r.from.trim()))}
              >
                {useAgent ? <Sparkles size={15} /> : <Wand2 size={15} />}
                {progress ? `Агент думает… ${progress[0]}/${progress[1]}` : 'Применить'}
              </button>
            </div>
            {result && (
              <div className="rule-result">
                <div>
                  Заменено типов блоков: <b>{result.applied.size}</b>
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

          <div className="schem-toolbar">
            <label className="search">
              <Search size={15} className="faint" />
              <input placeholder="Фильтр блоков" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </label>
            <span className="faint small">
              Заменено {replacedTypes} из {blocks.length}
            </span>
            {replace.size > 0 && (
              <button className="btn ghost sm" onClick={() => (setReplace(new Map()), setReasons(new Map()))}>
                <RotateCcw size={14} />
                Сбросить все
              </button>
            )}
          </div>

          <ul className="schem-blocks">
            {shown.map(({ id, count }) => {
              const known = items?.byId.get(id);
              const to = replace.get(id);
              return (
                <li key={id} className={cx('schem-row', to && 'replaced')}>
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
                    ) : to ? (
                      <>
                        <button
                          className="schem-target"
                          onClick={() => setPicking(id)}
                          title={reasons.get(id) ? `Агент: ${reasons.get(id)}` : 'Выбрать другой'}
                        >
                          <ItemIcon id={to} size={28} />
                          <span className="grow schem-names">
                            <span className="schem-name">{itemName(items?.byId.get(to), to)}</span>
                            <code className="schem-id">{to}</code>
                          </span>
                          {reasons.get(id) && <Sparkles size={13} className="ai-ico" aria-label="Выбрано агентом" />}
                        </button>
                        <button
                          className="btn ghost sm icon"
                          onClick={() => setTarget(id, null)}
                          aria-label="Отменить замену"
                          title="Отменить замену"
                        >
                          <X size={15} />
                        </button>
                      </>
                    ) : (
                      <button className="btn ghost sm schem-choose" onClick={() => setPicking(id)}>
                        Выбрать замену…
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
