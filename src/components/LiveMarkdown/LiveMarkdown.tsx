import type { EditorView } from '@codemirror/view';
import { refreshLivePreview, type InlineToken, type LiveMarkdownOptions } from 'cm-live-markdown';
import { LiveMarkdown as Editor, type LiveMarkdownHandle, type LiveMarkdownProps } from 'cm-live-markdown/react';
import { forwardRef } from 'react';
import { createRoot } from 'react-dom/client';
import { guiIcon, itemIconClasses, itemName, loadItems, type ItemIndex } from '@/shared/pack-data';
import { imageSrc, UPLOADING_SCHEME } from '../../lib/planImages';
import { isImage } from '../../lib/uploads';
import { cx } from '@/shared/lib';
import styles from './LiveMarkdown.module.css';
import { Markdown } from '../Markdown';

/**
 * «Живой» Markdown сайта: пакет cm-live-markdown плюс наше — значки предметов [[id|4]], картинки file:<id>,
 * таблицы через наш Markdown, русские подписи.
 */

export type { LiveMarkdownHandle };

type Props = Omit<LiveMarkdownProps, 'options' | 'extensions' | 'lang'>;

// ------------------------------------------------------------------ предметы [[id|4]]

let items: ItemIndex | null = null;
/** Редакторы, которые ждут справочник предметов — перерисовать значки после загрузки */
const waiting = new Set<EditorView>();

function itemChip(id: string, qty: string | undefined) {
  const it = items?.byId.get(id);
  const icon = document.createElement('span');
  const gui = guiIcon(it);
  icon.className = cx(
    itemIconClasses.root,
    gui?.smooth && itemIconClasses.smooth,
    !gui?.url && items && itemIconClasses.missing,
  );
  if (gui?.url) icon.style.backgroundImage = `url(${gui.url})`;
  if (qty === 'icon') {
    icon.style.width = icon.style.height = '20px';
    icon.title = itemName(it, id);
    return icon;
  }
  icon.style.width = icon.style.height = '18px';
  const chip = document.createElement('span');
  chip.className = 'item-chip';
  chip.title = id;
  chip.append(icon, itemName(it, id));
  if (qty) {
    const q = document.createElement('span');
    q.className = 'qty';
    q.textContent = `×${qty}`;
    chip.append(q);
  }
  return chip;
}

const itemToken: InlineToken = {
  pattern: /\[\[([a-z0-9_.-]+:[a-z0-9_/.-]+)(?:\|(\d+|icon))?\]\]/g,
  sourceClass: 'lmd-item-src',
  render: (m, view) => {
    if (!items && !waiting.has(view)) {
      waiting.add(view);
      loadItems().then((idx) => {
        items = idx;
        for (const v of waiting) if (v.dom.isConnected) v.dispatch({ effects: refreshLivePreview.of(null) });
        waiting.clear();
      });
    }
    return itemChip(m[1], m[2]);
  },
};

// ------------------------------------------------------------------ настройки пакета

const options: LiveMarkdownOptions = {
  tokens: [itemToken],
  images: {
    resolve: imageSrc,
    pending: (src) => src.startsWith(UPLOADING_SCHEME),
    accept: isImage,
  },
  tables: {
    render(source, dom) {
      const root = createRoot(dom);
      root.render(<Markdown source={source} />);
      // Размонтировать не посреди отрисовки React
      return () => queueMicrotask(() => root.unmount());
    },
  },
  phrases: {
    imageLoading: 'Загрузка картинки…',
    imageNotFound: 'Картинка не найдена',
    tableHint: 'Нажмите, чтобы править таблицу',
  },
};

export const LiveMarkdown = forwardRef<LiveMarkdownHandle, Props>(function LiveMarkdown(props, ref) {
  return <Editor ref={ref} {...props} className={cx(styles.editor, props.className)} lang="ru" options={options} />;
});

export default LiveMarkdown;
