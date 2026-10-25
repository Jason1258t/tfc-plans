import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cx, errorText, evalExpr, exprPath, type Scope } from '@/shared/lib';
import { formatValue, parseSpec, splitSpec } from '@/lib/guideFormat';
import type { GuideScope } from '@/lib/guideScope';
import { Markdown } from '@/components/Markdown';
import { BlockBoundary } from './BlockBoundary';
import { CalcBlock, CalcErrors, type Picker } from './CalcBlock';
import { GuideLinkContext, useGuideEditing } from './guideLinks';
import { compile, prepare, widgetCall } from './guideText';
import styles from './Guides.module.css';

/** Виджет раздела: то, что разметкой не описать (схемы-рисунки, особые графики) */
export type Widget = (props: { params: Record<string, string | number | boolean>; scope: Scope }) => ReactNode;

export interface GuideKit {
  scope: GuideScope;
  widgets: Record<string, { doc: string; render: Widget }>;
  pickers?: Record<string, Picker>;
}

/** Текст гайда: Markdown + живые значения + калькуляторы + виджеты */
export function GuideBody({ source, kit, onGuide }: { source: string; kit: GuideKit; onGuide: (id: string) => void }) {
  const prepared = useMemo(() => prepare(source, kit.scope.values), [source, kit.scope.values]);
  const envs = useMemo(() => [prepared.defs, kit.scope.values], [prepared.defs, kit.scope.values]);

  const link = (href: string, children: ReactNode) => {
    if (href.startsWith('gv:')) return <LiveValue src={decodeURIComponent(href.slice(3))} envs={envs} kit={kit} />;
    if (href.startsWith('guide:'))
      return (
        <button type="button" className="power-link" onClick={() => onGuide(href.slice(6))}>
          {children}
        </button>
      );
    if (href.startsWith('/')) return <Link to={href}>{children}</Link>;
    return null;
  };
  const block = (lang: string, text: string) => {
    if (lang === 'calc')
      return (
        <BlockBoundary text={text}>
          <CalcBlock text={text} envs={envs} pickers={kit.pickers} />
        </BlockBoundary>
      );
    if (lang === 'define') {
      const errs = prepared.defErrors.get(text.replace(/\n$/, ''));
      return errs ? <CalcErrors list={errs.map((e) => `define — ${e}`)} /> : <></>;
    }
    if (lang === 'widget') {
      const { name, params } = widgetCall(text);
      const w = kit.widgets[name];
      if (!w) return <CalcErrors list={[`нет виджета «${name}»: ${Object.keys(kit.widgets).join(', ')}`]} />;
      return (
        <BlockBoundary text={text}>
          <w.render params={params} scope={kit.scope.values} />
        </BlockBoundary>
      );
    }
    return null;
  };

  return (
    <GuideLinkContext.Provider value={link}>
      <BlockBoundary text={source}>
        <Markdown
          source={prepared.markdown}
          className={styles.guideBody}
          link={link}
          block={block}
          schemes={['gv:', 'guide:']}
        />
      </BlockBoundary>
    </GuideLinkContext.Provider>
  );
}

/** {{выражение | формат}} в тексте; у настройки сервера — подсказка, откуда значение, и пометка, если изменено */
function LiveValue({ src, envs, kit }: { src: string; envs: Scope[]; kit: GuideKit }) {
  const editing = useGuideEditing();
  const { expr, spec } = splitSpec(src);
  let text: string;
  let st: ReturnType<NonNullable<GuideScope['setting']>> = null;
  try {
    const e = compile(expr.trim());
    text = formatValue(evalExpr(e, ...envs), parseSpec(spec));
    const path = exprPath(e);
    st = path && path.length > 1 ? (kit.scope.setting?.(path) ?? null) : null;
  } catch (err) {
    // Читателю — прочерк с подсказкой, в редакторе — сама формула
    return (
      <span className={styles.guideValError} title={errorText(err, expr.trim())}>
        {editing ? `⚠ ${expr.trim()}` : '—'}
      </span>
    );
  }
  if (!st) return <span className={styles.guideVal}>{text}</span>;
  return (
    <span
      className={cx('power-cfg', st.changed && 'changed')}
      title={st.origin + (st.changed && st.default !== null ? `; в моде по умолчанию ${formatValue(st.default)}` : '')}
    >
      {text}
      {st.changed && <sup>сервер</sup>}
    </span>
  );
}
