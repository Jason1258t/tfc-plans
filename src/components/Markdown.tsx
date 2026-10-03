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

export function Markdown({ source, className }: { source: string; className?: string }) {
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
        }}
      >
        {preprocess(source)}
      </ReactMarkdown>
    </div>
  );
}
