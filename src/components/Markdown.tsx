import { createContext, useContext, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { itemName, useItems } from '../lib/items';
import { ItemIcon } from './ItemIcon';

/**
 * Markdown с поддержкой ссылок на предметы:
 *   [[tfc:metal/ingot/copper]]      → иконка + название
 *   [[tfc:metal/ingot/copper|16]]   → иконка + название + количество
 *   [[tfc:metal/ingot/copper|icon]] → только иконка (рядом со своим названием)
 */
const ITEM_TOKEN = /\[\[([a-z0-9_.-]+:[a-z0-9_/.-]+)(?:\|(\d+|icon))?\]\]/g;

export const itemToken = (id: string, qty?: number) => `[[${id}${qty ? `|${qty}` : ''}]]`;

function preprocess(src: string) {
  return src.replace(ITEM_TOKEN, (_, id: string, qty?: string) => `[item](item:${id}${qty ? `?${qty}` : ''})`);
}

function ItemChip({ href }: { href: string }) {
  const items = useItems();
  const [id, qty] = href.slice('item:'.length).split('?');
  if (qty === 'icon') return <ItemIcon id={id} size={20} />;
  return (
    <span className="item-chip">
      <ItemIcon id={id} size={18} />
      {itemName(items?.byId.get(id), id)}
      {qty && <span className="qty">×{qty}</span>}
    </span>
  );
}

const TASK_BOX = /^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/;

/** Переключает чекбокс `- [ ]` в строке исходника (нумерация с 1); null — в строке чекбокса нет */
export function toggleTaskLine(source: string, line: number): string | null {
  const lines = source.split('\n');
  const text = lines[line - 1];
  if (text === undefined || !TASK_BOX.test(text)) return null;
  lines[line - 1] = text.replace(TASK_BOX, (_, head: string, mark: string) => `${head}[${mark === ' ' ? 'x' : ' '}]`);
  return lines.join('\n');
}

/** Строка исходника, с которой начинается текущий пункт списка, — чтобы чекбокс знал, что править */
const TaskLine = createContext<number | null>(null);

function TaskBox({ checked, onToggle }: { checked: boolean; onToggle?: (line: number) => void }) {
  const line = useContext(TaskLine);
  if (!onToggle || line === null) return <input type="checkbox" checked={checked} disabled readOnly />;
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={() => onToggle(line)}
      // Двойной клик по просмотру открывает редактор — быстрые клики по чекбоксу не должны
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}

interface Props {
  source: string;
  className?: string;
  /** Клик по чекбоксу списка задач; без него чекбоксы только показываются */
  onToggleTask?: (line: number) => void;
  /** Своя обработка ссылки (гайды: живые значения, ссылки на статьи); null — обычная ссылка */
  link?: (href: string, children: ReactNode) => ReactNode | null;
  /** Свой показ блока кода по языку (гайды: calc, widget); null — обычный блок */
  block?: (lang: string, text: string) => ReactNode | null;
  /** Ссылки с этими схемами не вырезать (item: — всегда) */
  schemes?: string[];
  /** Строчный вид: без обёртки-абзаца (ячейки таблиц, подписи) */
  inline?: boolean;
}

interface HastNode {
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

const hastText = (n: HastNode): string => n.value ?? (n.children ?? []).map(hastText).join('');

export function Markdown({ source, className, onToggleTask, link, block, schemes, inline }: Props) {
  const keep = ['item:', ...(schemes ?? [])];
  const Wrap = inline ? 'span' : 'div';
  return (
    <Wrap className={`md ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (keep.some((k) => url.startsWith(k)) ? url : defaultUrlTransform(url))}
        components={{
          ...(inline ? { p: ({ children }) => <>{children}</> } : {}),
          pre: ({ node, children, ...rest }) => {
            const code = (node as HastNode | undefined)?.children?.find((c) => c.tagName === 'code');
            const cls = code?.properties?.className;
            const lang = Array.isArray(cls) ? String(cls.find((c) => String(c).startsWith('language-')) ?? '') : '';
            const custom = block && code && lang ? block(lang.slice('language-'.length), hastText(code)) : null;
            return custom ?? <pre {...rest}>{children}</pre>;
          },
          a: ({ href, children }) => {
            if (href?.startsWith('item:')) return <ItemChip href={href} />;
            const custom = href && link ? link(href, children) : null;
            return (
              custom ?? (
                <a href={href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              )
            );
          },
          li: ({ node, children, ...rest }) => (
            <li {...rest}>
              <TaskLine.Provider value={node?.position?.start.line ?? null}>{children}</TaskLine.Provider>
            </li>
          ),
          input: ({ type, checked }) =>
            type === 'checkbox' ? <TaskBox checked={Boolean(checked)} onToggle={onToggleTask} /> : null,
        }}
      >
        {preprocess(source)}
      </ReactMarkdown>
    </Wrap>
  );
}
