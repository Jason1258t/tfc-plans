import { parseRefs } from '@tfc/pack-server/dev-refs';
import type { ComponentProps, MouseEvent } from 'react';
import { Markdown } from '@/components/Markdown';
import { cx } from '@/shared/lib';
import styles from './DevMarkdown.module.css';

const SCHEME = 'devref:';

/** Ссылки #175, doc:12, note:881 → обычные ссылки markdown; строки не сдвигаются, чекбоксы продолжают работать */
function linkRefs(source: string) {
  let out = '';
  let last = 0;
  for (const r of parseRefs(source)) {
    const label = source.slice(r.start, r.end).replace(/[\\[\]]/g, '\\$&');
    out += `${source.slice(last, r.start)}[${label}](${SCHEME}${encodeURIComponent(r.ref)})`;
    last = r.end;
  }
  return out + source.slice(last);
}

export const refHref = (ref: string) => `/dev?ref=${encodeURIComponent(ref)}`;

/** Клик по ссылке на объект трекера: Ctrl и Cmd оставляют обычное открытие в новой вкладке */
export const refClick = (ref: string, onOpen: (ref: string) => void) => (e: MouseEvent) => {
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  onOpen(ref);
};

interface Props extends Omit<ComponentProps<typeof Markdown>, 'link' | 'schemes'> {
  onOpenRef: (ref: string) => void;
  /** Ссылки, которых нет на сервере: показываются как битые */
  broken?: Set<string>;
}

/** Markdown задач разработки: ссылки на задачи, пункты, документы и записи кликабельны */
export function DevMarkdown({ source, onOpenRef, broken, ...rest }: Props) {
  return (
    <Markdown
      {...rest}
      source={linkRefs(source)}
      schemes={[SCHEME]}
      link={(href, children) => {
        if (!href.startsWith(SCHEME)) return null;
        const ref = decodeURIComponent(href.slice(SCHEME.length));
        const dead = broken?.has(ref);
        return (
          <a
            className={cx(styles.ref, dead && styles.broken)}
            href={refHref(ref)}
            title={dead ? 'Такого нет: ссылка битая' : undefined}
            onClick={refClick(ref, onOpenRef)}
          >
            {children}
          </a>
        );
      }}
    />
  );
}
