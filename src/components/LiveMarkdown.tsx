import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import {
  Annotation,
  EditorSelection,
  EditorState,
  Prec,
  RangeSetBuilder,
  StateEffect,
  type Extension,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  placeholder as placeholderExt,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { guiIcon, itemName, loadItems, type ItemIndex } from '../lib/items';
import './LiveMarkdown.css';

/**
 * «Живой» Markdown, как Live Preview в Obsidian: текст остаётся Markdown, оформление рисуется поверх,
 * служебные символы видны только там, где стоит курсор.
 */

export interface LiveMarkdownHandle {
  focus: () => void;
  /** Поставить курсор/выделение (позиции в исходнике) */
  select: (from: number, to?: number) => void;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (range: [number, number]) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
}

// ------------------------------------------------------------------ предметы [[id|4]]

const ITEM_TOKEN = /\[\[([a-z0-9_.-]+:[a-z0-9_/.-]+)(?:\|(\d+|icon))?\]\]/g;

let items: ItemIndex | null = null;
/** Справочник предметов догрузился — перерисовать значки */
const itemsLoaded = StateEffect.define<null>();

class ItemWidget extends WidgetType {
  readonly id: string;
  readonly qty: string | undefined;
  /** Справочник был загружен, когда рисовали — иначе после загрузки перерисовать */
  readonly ready = !!items;
  constructor(id: string, qty: string | undefined) {
    super();
    this.id = id;
    this.qty = qty;
  }
  eq(other: ItemWidget) {
    return other.id === this.id && other.qty === this.qty && other.ready === this.ready;
  }
  toDOM() {
    const it = items?.byId.get(this.id);
    const icon = document.createElement('span');
    const url = guiIcon(it)?.url;
    icon.className = 'item-icon' + (guiIcon(it)?.smooth ? ' smooth' : '') + (!url && items ? ' missing' : '');
    if (url) icon.style.backgroundImage = `url(${url})`;
    if (this.qty === 'icon') {
      icon.style.width = icon.style.height = '20px';
      icon.title = itemName(it, this.id);
      return icon;
    }
    icon.style.width = icon.style.height = '18px';
    const chip = document.createElement('span');
    chip.className = 'item-chip';
    chip.title = this.id;
    chip.append(icon, itemName(it, this.id));
    if (this.qty) {
      const q = document.createElement('span');
      q.className = 'qty';
      q.textContent = `×${this.qty}`;
      chip.append(q);
    }
    return chip;
  }
  ignoreEvent() {
    return false;
  }
}

// ------------------------------------------------------------------ чекбоксы и маркеры списков

class CheckboxWidget extends WidgetType {
  readonly checked: boolean;
  constructor(checked: boolean) {
    super();
    this.checked = checked;
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM() {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.checked;
    box.className = 'lmd-check';
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const dot = document.createElement('span');
    dot.className = 'lmd-bullet';
    dot.textContent = '•';
    return dot;
  }
}
const bullet = new BulletWidget();

// ------------------------------------------------------------------ оформление по дереву

const hide = Decoration.replace({});
const mark = (cls: string) => Decoration.mark({ class: cls });
const line = (cls: string) => Decoration.line({ class: cls });

const INLINE: Record<string, string> = {
  Emphasis: 'lmd-em',
  StrongEmphasis: 'lmd-strong',
  Strikethrough: 'lmd-strike',
  InlineCode: 'lmd-code',
  Link: 'lmd-link',
};
const HIDDEN_MARKS = new Set(['EmphasisMark', 'StrikethroughMark', 'LinkMark', 'URL']);

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const sel = state.selection.ranges;
  /** Участок [from, to] задевает курсор/выделение — показываем исходник */
  const touched = (from: number, to: number) => sel.some((r) => r.from <= to && r.to >= from);
  const activeLine = (pos: number) => {
    const l = state.doc.lineAt(pos);
    return touched(l.from, l.to);
  };

  // Декорации собираем списком и сортируем: дерево и регулярка идут вперемешку
  const out: { from: number; to: number; deco: Decoration }[] = [];
  const add = (from: number, to: number, deco: Decoration) => out.push({ from, to, deco });
  const addLine = (pos: number, deco: Decoration) => out.push({ from: pos, to: pos, deco });
  const codeRanges: [number, number][] = [];

  for (const { from, to } of view.visibleRanges) {
    // Предметы — не часть грамматики Markdown (парсер видит в [[id]] ссылку), ищем регуляркой
    const tokens = [...state.sliceDoc(from, to).matchAll(ITEM_TOKEN)].map((m) => ({
      from: from + m.index,
      to: from + m.index + m[0].length,
      id: m[1],
      qty: m[2],
    }));

    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (tokens.some((t) => node.from >= t.from && node.to <= t.to)) return false;
        const name = node.name;
        const parent = node.node.parent;

        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          addLine(state.doc.lineAt(node.from).from, line(`lmd-h lmd-h${heading[1]}`));
          return;
        }
        if (name === 'HeaderMark' && parent?.name.startsWith('ATXHeading')) {
          if (!activeLine(node.from)) {
            // Вместе с пробелом после #
            const end = Math.min(node.to + 1, state.doc.lineAt(node.from).to);
            add(node.from, end, hide);
          }
          return;
        }
        if (INLINE[name]) {
          add(node.from, node.to, mark(INLINE[name]));
          if (name === 'InlineCode') codeRanges.push([node.from, node.to]);
          return;
        }
        if ((HIDDEN_MARKS.has(name) || (name === 'CodeMark' && parent?.name === 'InlineCode')) && parent) {
          if (!touched(parent.from, parent.to)) add(node.from, node.to, hide);
          return;
        }
        if (name === 'FencedCode' || name === 'CodeBlock') {
          codeRanges.push([node.from, node.to]);
          for (let pos = node.from; pos <= node.to;) {
            const l = state.doc.lineAt(pos);
            addLine(l.from, line('lmd-codeblock'));
            pos = l.to + 1;
          }
          return false;
        }
        if (name === 'Blockquote') {
          for (let pos = node.from; pos <= node.to;) {
            const l = state.doc.lineAt(pos);
            addLine(l.from, line('lmd-quote'));
            pos = l.to + 1;
          }
          return;
        }
        if (name === 'QuoteMark') {
          if (!activeLine(node.from)) add(node.from, Math.min(node.to + 1, state.doc.lineAt(node.from).to), hide);
          return;
        }
        if (name === 'HorizontalRule') {
          if (!activeLine(node.from)) {
            addLine(state.doc.lineAt(node.from).from, line('lmd-hr'));
            add(node.from, node.to, hide);
          }
          return;
        }
        if (name === 'Table') {
          for (let pos = node.from; pos <= node.to;) {
            const l = state.doc.lineAt(pos);
            addLine(l.from, line('lmd-table'));
            pos = l.to + 1;
          }
          return;
        }
        if (name === 'ListMark' && parent?.parent?.name === 'BulletList') {
          // Пункт с чекбоксом: маркер списка прячем совсем, остаётся флажок
          const isTask = parent.getChild('Task');
          if (activeLine(node.from)) return;
          if (isTask) add(node.from, Math.min(node.to + 1, state.doc.lineAt(node.from).to), hide);
          else add(node.from, node.to, Decoration.replace({ widget: bullet }));
          return;
        }
        if (name === 'TaskMarker') {
          if (!touched(node.from, node.to)) {
            const checked = /x/i.test(state.sliceDoc(node.from, node.to));
            add(node.from, node.to, Decoration.replace({ widget: new CheckboxWidget(checked) }));
            if (checked && parent) add(node.to, parent.to, mark('lmd-done'));
          }
          return;
        }
      },
    });

    for (const t of tokens) {
      if (codeRanges.some(([a, b]) => t.from >= a && t.to <= b)) continue;
      if (touched(t.from, t.to)) add(t.from, t.to, mark('lmd-item-src'));
      else add(t.from, t.to, Decoration.replace({ widget: new ItemWidget(t.id, t.qty) }));
    }
  }

  out.sort((a, b) => a.from - b.from || a.deco.startSide - b.deco.startSide);
  const builder = new RangeSetBuilder<Decoration>();
  let lastHideEnd = -1;
  for (const d of out) {
    // Пересекающиеся замены RangeSetBuilder не любит — внутренние пропускаем
    const isReplace = d.from !== d.to && (d.deco.spec.widget || d.deco === hide);
    if (isReplace && d.from < lastHideEnd) continue;
    builder.add(d.from, d.to, d.deco);
    if (isReplace) lastHideEnd = d.to;
  }
  return builder.finish();
}

const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      const redraw = u.transactions.some((t) => t.effects.some((e) => e.is(itemsLoaded)));
      if (
        u.docChanged ||
        u.selectionSet ||
        u.viewportChanged ||
        redraw ||
        syntaxTree(u.startState) !== syntaxTree(u.state)
      )
        this.decorations = build(u.view);
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(e, view) {
        const target = e.target as HTMLElement;
        if (target instanceof HTMLInputElement && target.classList.contains('lmd-check')) {
          const pos = view.posAtDOM(target);
          const text = view.state.sliceDoc(pos, pos + 3);
          if (/^\[[ xX]\]$/.test(text)) {
            view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: text[1] === ' ' ? 'x' : ' ' } });
            e.preventDefault();
            return true;
          }
        }
        // Ctrl/Cmd+клик по ссылке — открыть
        if (e.metaKey || e.ctrlKey) {
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos === null) return false;
          for (let n: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, 1); n; n = n.parent) {
            if (n.name !== 'Link') continue;
            const url = n.getChild('URL');
            if (url) window.open(view.state.sliceDoc(url.from, url.to), '_blank', 'noreferrer');
            e.preventDefault();
            return true;
          }
        }
        return false;
      },
    },
  },
);

// ------------------------------------------------------------------ компонент

/** Правка пришла снаружи (props.value) — не отдавать её обратно в onChange */
const external = Annotation.define<boolean>();

/** Правка только изменившегося куска — чтобы чужие правки не сбивали курсор */
function diff(a: string, b: string) {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  return { from: s, to: a.length - e, insert: b.slice(s, b.length - e) };
}

export const LiveMarkdown = forwardRef<LiveMarkdownHandle, Props>(function LiveMarkdown(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cb = useRef(props);
  useLayoutEffect(() => {
    cb.current = props;
  });

  useEffect(() => {
    const extensions: Extension[] = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      // Без markdown(): тот тянет подсветку HTML/CSS/JS (~100 КБ), а нам нужна только разметка
      markdownLanguage,
      // Enter продолжает список/чекбоксы — раньше обычного Enter
      Prec.high(keymap.of(markdownKeymap)),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: 'true', lang: 'ru' }),
      livePreview,
      EditorView.updateListener.of((u) => {
        const fromOutside = u.transactions.some((t) => t.annotation(external));
        if (u.docChanged && !fromOutside) cb.current.onChange(u.state.doc.toString());
        if (u.selectionSet || u.docChanged) {
          const r = u.state.selection.main;
          cb.current.onSelect?.([r.from, r.to]);
        }
        if (u.focusChanged && !u.view.hasFocus) cb.current.onBlur?.();
      }),
    ];
    if (cb.current.placeholder) extensions.push(placeholderExt(cb.current.placeholder));
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({ doc: cb.current.value, extensions }),
    });
    view.current = v;
    if (!items)
      loadItems().then((idx) => {
        items = idx;
        view.current?.dispatch({ effects: itemsLoaded.of(null) });
      });
    return () => {
      v.destroy();
      view.current = null;
    };
  }, []);

  // Текст поменялся снаружи (вставка предмета, агент, чужая правка)
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== props.value) v.dispatch({ changes: diff(cur, props.value), annotations: external.of(true) });
  }, [props.value]);

  useImperativeHandle(ref, () => ({
    focus: () => view.current?.focus(),
    select: (from, to = from) => {
      const v = view.current;
      if (!v) return;
      const len = v.state.doc.length;
      v.dispatch({ selection: EditorSelection.single(Math.min(from, len), Math.min(to, len)), scrollIntoView: true });
    },
  }));

  return <div ref={host} className={`lmd ${props.className ?? ''}`} />;
});

export default LiveMarkdown;
