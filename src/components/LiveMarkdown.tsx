import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import {
  Annotation,
  EditorSelection,
  EditorState,
  Prec,
  RangeSetBuilder,
  StateEffect,
  StateField,
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
import { createRoot, type Root } from 'react-dom/client';
import { guiIcon, itemName, loadItems, type ItemIndex } from '../lib/items';
import { imageSrc, UPLOADING_SCHEME } from '../lib/planImages';
import { isImage } from '../lib/uploads';
import './LiveMarkdown.css';
import { liveMarkdownKeymap } from './liveMarkdownCommands';
import { Markdown } from './Markdown';

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
  /** Вставили или бросили картинки — загрузить и вставить в позицию pos */
  onImages?: (files: File[], pos: number) => void;
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

// ------------------------------------------------------------------ картинки ![подпись](file:id | https://…)

class ImageWidget extends WidgetType {
  readonly src: string;
  readonly alt: string;
  constructor(src: string, alt: string) {
    super();
    this.src = src;
    this.alt = alt;
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM() {
    const note = (text: string) => {
      const span = document.createElement('span');
      span.className = 'md-img-note';
      span.textContent = text;
      return span;
    };
    if (this.src.startsWith(UPLOADING_SCHEME)) return note('Загрузка картинки…');
    const img = document.createElement('img');
    img.className = 'lmd-img';
    img.alt = this.alt;
    imageSrc(this.src).then(
      (url) => (img.src = url),
      () => img.replaceWith(note(`Картинка не найдена${this.alt ? `: ${this.alt}` : ''}`)),
    );
    return img;
  }
  get estimatedHeight() {
    return 240;
  }
  ignoreEvent() {
    return false;
  }
}

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
  // Без фокуса показываем всё оформлённым, как в просмотре
  const focused = view.hasFocus;
  const touched = (from: number, to: number) => focused && sel.some((r) => r.from <= to && r.to >= from);
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
        if (name === 'Image') {
          const url = node.node.getChild('URL');
          if (url && !touched(node.from, node.to)) {
            const alt = state.sliceDoc(node.from + 2, Math.max(node.from + 2, url.from - 2));
            add(
              node.from,
              node.to,
              Decoration.replace({ widget: new ImageWidget(state.sliceDoc(url.from, url.to), alt) }),
            );
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

// ------------------------------------------------------------------ таблицы — отрисованная таблица вне курсора

const tableRoots = new WeakMap<HTMLElement, Root>();

class TableWidget extends WidgetType {
  readonly text: string;
  constructor(text: string) {
    super();
    this.text = text;
  }
  eq(other: TableWidget) {
    return other.text === this.text;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement('div');
    dom.className = 'lmd-table-widget';
    dom.title = 'Нажмите, чтобы править таблицу';
    const root = createRoot(dom);
    root.render(<Markdown source={this.text} />);
    tableRoots.set(dom, root);
    // Клик — курсор в ту же строку исходника: таблица раскрывается в текст с |
    dom.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('a')) return;
      e.preventDefault();
      const rows = [...dom.querySelectorAll('tr')];
      const row = rows.indexOf((e.target as HTMLElement).closest('tr')!);
      // Строка-разделитель | --- | есть в исходнике, но не в таблице
      const lineOffset = row <= 0 ? 0 : row + 1;
      const first = view.state.doc.lineAt(view.posAtDOM(dom));
      const line = view.state.doc.line(Math.min(first.number + lineOffset, view.state.doc.lines));
      view.dispatch({ selection: { anchor: Math.min(line.from + 2, line.to) } });
      view.focus();
    });
    return dom;
  }
  destroy(dom: HTMLElement) {
    const root = tableRoots.get(dom);
    // Размонтировать не посреди отрисовки React
    if (root) queueMicrotask(() => root.unmount());
  }
  get estimatedHeight() {
    return 32 * this.text.split('\n').length;
  }
  ignoreEvent() {
    return true;
  }
}

/** Фокус редактора — в состоянии, чтобы без фокуса таблицы были отрисованы, даже если курсор в них */
const setFocus = StateEffect.define<boolean>();

function buildTables(state: EditorState, focused: boolean): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table')
        return (
          node.name === 'Document' ||
          node.name.endsWith('List') ||
          node.name === 'ListItem' ||
          node.name === 'Blockquote'
        );
      const from = state.doc.lineAt(node.from).from;
      const to = state.doc.lineAt(node.to).to;
      const inside = state.selection.ranges.some((r) => r.from <= to && r.to >= from);
      // Таблица внутри списка/цитаты — оставляем текстом: префиксы строк не часть таблицы
      if (from !== node.from) return false;
      if (!(focused && inside))
        builder.add(from, to, Decoration.replace({ widget: new TableWidget(state.sliceDoc(from, to)), block: true }));
      return false;
    },
  });
  return builder.finish();
}

const tables = StateField.define<{ focused: boolean; decos: DecorationSet }>({
  create: (state) => ({ focused: false, decos: buildTables(state, false) }),
  update(value, tr) {
    let focused = value.focused;
    for (const e of tr.effects) if (e.is(setFocus)) focused = e.value;
    if (
      focused === value.focused &&
      !tr.docChanged &&
      !tr.selection &&
      syntaxTree(tr.startState) === syntaxTree(tr.state)
    )
      return value;
    return { focused, decos: buildTables(tr.state, focused) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
});

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
        u.focusChanged ||
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
  /** Последний текст, отданный в onChange */
  const emitted = useRef(props.value);
  useLayoutEffect(() => {
    cb.current = props;
  });

  useEffect(() => {
    const extensions: Extension[] = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      // Без markdown(): тот тянет подсветку HTML/CSS/JS (~100 КБ), а нам нужна только разметка
      markdownLanguage,
      // Enter продолжает список/чекбоксы — раньше обычного Enter
      // Свои команды раньше стандартных Markdown: Tab/Shift+Tab — вложенность списков и ячейки таблиц,
      // Backspace за маркером, Ctrl+B/I/E/K, Ctrl+Enter — чекбокс
      Prec.high(keymap.of(liveMarkdownKeymap)),
      Prec.high(keymap.of(markdownKeymap)),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: 'true', lang: 'ru' }),
      EditorView.domEventHandlers({
        paste(e, v) {
          const files = [...(e.clipboardData?.files ?? [])].filter(isImage);
          if (!files.length || !cb.current.onImages) return false;
          e.preventDefault();
          cb.current.onImages(files, v.state.selection.main.head);
          return true;
        },
        drop(e, v) {
          const files = [...(e.dataTransfer?.files ?? [])].filter(isImage);
          if (!files.length || !cb.current.onImages) return false;
          e.preventDefault();
          const pos = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.selection.main.head;
          cb.current.onImages(files, pos);
          return true;
        },
      }),
      livePreview,
      tables,
      EditorView.focusChangeEffect.of((_, focusing) => setFocus.of(focusing)),
      EditorView.updateListener.of((u) => {
        const fromOutside = u.transactions.some((t) => t.annotation(external));
        if (u.docChanged && !fromOutside) {
          emitted.current = u.state.doc.toString();
          cb.current.onChange(emitted.current);
        }
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
    // Наш же текст вернулся через родителя — не трогаем: редактор мог уже уйти вперёд (быстрый ввод)
    if (props.value === emitted.current) return;
    const cur = v.state.doc.toString();
    emitted.current = props.value;
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
