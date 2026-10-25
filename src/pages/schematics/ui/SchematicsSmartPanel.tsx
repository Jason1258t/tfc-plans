import { ArrowRight, Plus, Sparkles, X } from 'lucide-react';
import type { Rule } from '@/lib/schematic';
import { cx } from '@/shared/lib';
import type { SmartResult } from '../model/schematicFormat';
import type { AgentPrefs } from '../model/schematicPrefs';
import section from '../SchematicsSection.module.css';
import styles from '../SchematicsPage.module.css';

interface Props {
  useAgent: boolean;
  geminiEnabled: boolean;
  agentPrefs: AgentPrefs;
  onAgent: (patch: Partial<AgentPrefs>) => void;
  rules: Rule[];
  onRules: (rules: Rule[]) => void;
  overwrite: boolean;
  onOverwrite: (value: boolean) => void;
  result: SmartResult | null;
}

/** Раскрытая панель «Умная замена»: правила, пожелания агенту и итог последнего запуска */
export function SchematicsSmartPanel({
  useAgent,
  geminiEnabled,
  agentPrefs,
  onAgent,
  rules,
  onRules,
  overwrite,
  onOverwrite,
  result,
}: Props) {
  return (
    <section className={styles.rulesBox}>
      <div className="row">
        <p className="faint small grow" style={{ margin: 0 }}>
          {useAgent
            ? 'Нечёткий поиск подбирает похожие предметы сборки (с учётом правил), агент Gemini выбирает подходящий по форме и материалу.'
            : 'Правила по очереди заменяют подстроку в id блока. Замена принимается, только если такой предмет есть в сборке.'}
        </p>
        {geminiEnabled && (
          <label className={cx('toggle', section.smToggle, styles.agentToggle)}>
            <input
              type="checkbox"
              checked={agentPrefs.enabled}
              onChange={(e) => onAgent({ enabled: e.target.checked })}
            />
            <Sparkles size={13} />
            Использовать агента
          </label>
        )}
      </div>
      {useAgent && (
        <input
          className={cx('input', styles.agentHint)}
          value={agentPrefs.hint}
          placeholder="Пожелания агенту: «дуб → эвкалипт, камень → гранит, стекло оставить»"
          aria-label="Пожелания агенту"
          onChange={(e) => onAgent({ hint: e.target.value })}
        />
      )}
      <ul className={styles.rules}>
        {rules.map((r, i) => (
          <li key={i}>
            <input
              className="input"
              value={r.from}
              placeholder={useAgent ? 'подсказка: что (oak)' : 'что (oak)'}
              aria-label="Что заменить"
              onChange={(e) => onRules(rules.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}
            />
            <ArrowRight size={14} className="faint" />
            <input
              className="input"
              value={r.to}
              placeholder="на что (spruce)"
              aria-label="На что заменить"
              onChange={(e) => onRules(rules.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))}
            />
            <button
              className="btn ghost sm icon"
              onClick={() => onRules(rules.filter((_, j) => j !== i))}
              aria-label="Удалить правило"
            >
              <X size={14} />
            </button>
          </li>
        ))}
        <li>
          <button className="btn ghost sm" onClick={() => onRules([...rules, { from: '', to: '' }])}>
            <Plus size={14} />
            Правило
          </button>
        </li>
      </ul>
      <label className={cx('toggle', section.smToggle)} style={{ alignSelf: 'flex-start' }}>
        <input type="checkbox" checked={overwrite} onChange={(e) => onOverwrite(e.target.checked)} />
        Перезаписывать ручные замены
      </label>
      {result && (
        <div className={styles.ruleResult}>
          <div>
            Заменено типов блоков: <b>{result.applied.size}</b>
            {result.kind === 'agent' && <span className="faint"> · запросов к агенту: {result.requests}</span>}
            {result.kind === 'agent' && result.kept.length > 0 && (
              <>
                {' '}
                · оставлено как есть: <b>{result.kept.length}</b>
              </>
            )}
            {result.failed.length > 0 && (
              <>
                {' '}
                · не удалось: <b className={styles.badCount}>{result.failed.length}</b>
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
              <ul className={styles.ruleFailed}>
                {result.failed.map((f) => (
                  <li key={f.source}>
                    <code>{f.source}</code>
                    {f.target && (
                      <>
                        {' '}
                        → <code className={styles.bad}>{f.target}</code>
                      </>
                    )}
                    {'reason' in f && <span className="faint"> — {f.reason}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {result.kind === 'agent' && result.kept.length > 0 && (
            <details className={styles.kept}>
              <summary>Оставлены как есть</summary>
              <ul className={styles.ruleFailed}>
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
  );
}
