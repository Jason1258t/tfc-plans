import { createContext, useContext } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { itemName, useItems } from '../lib/items';
import { ItemIcon } from './ItemIcon';

/**
 * Markdown с поддержкой ссылок на предметы:
 *   [[tfc:metal/ingot/copper]]      → иконка + название
 *   [[tfc:metal/ingot/copper|16]]   → иконка + название + количество
 */
const ITEM_TOKEN = /\[\[([a-z0-9_.-]+:[a-z0-9_/.-]+)(?:\|(\d+))?\]\]/g;

export const itemToken = (id: string, qty?: number) => `[[${id}${qty ? `|${qty}` : ''}]]`;

function preprocess(src: string) {
  return src.replace(ITEM_TOKEN, (_, id: string, qty?: string) => `[item](item:${id}${qty ? `?${qty}` : ''})`);
}

function ItemChip({ href }: { href: string }) {
  const items = useItems();
  const [id, qty] = href.slice('item:'.length).split('?');
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
}

export function Markdown({ source, className, onToggleTask }: Props) {
  return (
    <div className={`md ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (url.startsWith('item:') ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href, children }) =>
            href?.startsWith('item:') ? (
              <ItemChip href={href} />
            ) : (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
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
    </div>
  );
}
