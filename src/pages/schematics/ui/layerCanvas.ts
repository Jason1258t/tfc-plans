import { blockEntry, blockIcon, type ItemIndex } from '@/shared/pack-data';
import {
  blockTopView,
  drawnByCode,
  EMPTY_BLOCKS,
  isFullCube,
  REMOVE,
  stateOf,
  type Schematic,
} from '@/entities/schematic';

/** Масштаб — пикселей на блок */
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 96;

// Иконки для холста: общий кеш на страницу
const images = new Map<string, HTMLImageElement>();
function image(url: string, onLoad: () => void) {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    images.set(url, img);
  }
  if (!img.complete) img.addEventListener('load', onLoad, { once: true });
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** Цвет блока без иконки — по id, чтобы одинаковые блоки были одного цвета */
function hashColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return `hsl(${((h % 360) + 360) % 360} 45% 55%)`;
}

const FACING: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };

export interface PaintOptions {
  canvas: HTMLCanvasElement;
  box: { w: number; h: number };
  view: { zoom: number; ox: number; oy: number };
  sx: number;
  sz: number;
  schematic: Schematic;
  names: (string | null)[];
  props: Map<string, string>[];
  layer: Int32Array | undefined;
  /** Слой ниже — бледно в пустых клетках, если включён «Слой ниже» */
  below: Int32Array | undefined;
  ghost: boolean;
  items: ItemIndex | null;
  effective: (name: string) => string;
  /** Клетки под ПКМ, пока кнопку не отпустили */
  stroke: Set<number> | null;
  highlight: string | null;
  selected: ReadonlySet<number>;
  hover: { x: number; z: number } | null;
  menu: { x: number; z: number } | null;
  area: { x0: number; z0: number; x1: number; z1: number; off: boolean } | null;
  /** Перерисовать, когда догрузилась иконка или вид сверху */
  again: () => void;
}

/**
 * Рисование слоя на холсте: подложка, блоки (вид сверху по модели из jar, иначе иконка или цвет),
 * сетка, выделение, курсор и рамка. Чистая функция от состояния вида — вызывается из эффекта редактора.
 */
export function paintLayer(o: PaintOptions) {
  const {
    canvas,
    box,
    view,
    sx,
    sz,
    schematic: s,
    names,
    props,
    layer,
    below,
    ghost,
    items,
    effective,
    stroke,
    highlight,
    selected,
    hover,
    menu,
    area,
    again,
  } = o;
  if (!canvas || !box.w) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(box.w * dpr);
  canvas.height = Math.round(box.h * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, box.w, box.h);
  const css = getComputedStyle(canvas);
  const color = (v: string) => css.getPropertyValue(v).trim();
  const { zoom, ox, oy } = view;

  // Подложка схемы
  ctx.fillStyle = color('--surface');
  ctx.fillRect(ox, oy, sx * zoom, sz * zoom);

  const x0 = Math.max(0, Math.floor(-ox / zoom));
  const z0 = Math.max(0, Math.floor(-oy / zoom));
  const x1 = Math.min(sx, Math.ceil((box.w - ox) / zoom));
  const z1 = Math.min(sz, Math.ceil((box.h - oy) / zoom));

  const drawBlock = (id: string, st: number, px: number, py: number, alpha: number) => {
    const p = props[st] ?? new Map();
    // Вид сверху по модели из jar; нет модели (рисует код) — иконка предмета
    const top = drawnByCode(id) ? null : blockTopView(id, p, again);
    if (top) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(top, px, py, zoom, zoom);
      ctx.globalAlpha = 1;
      return;
    }
    if (top === undefined) return;
    const icon = blockIcon(blockEntry(items, id), isFullCube(id, p));
    const img = icon ? image(icon.url, again) : null;
    ctx.globalAlpha = alpha;
    if (img) {
      // Нарисованная модель уже сглажена — уменьшать плавно; текстуру 16×16 — по пикселям
      ctx.imageSmoothingEnabled = !!icon?.smooth;
      ctx.drawImage(img, px, py, zoom, zoom);
      ctx.imageSmoothingEnabled = false;
    } else {
      ctx.fillStyle = hashColor(id);
      ctx.fillRect(px + zoom * 0.08, py + zoom * 0.08, zoom * 0.84, zoom * 0.84);
    }
    ctx.globalAlpha = 1;
  };

  const danger = color('--danger');
  const accent = color('--accent');
  for (let z = z0; z < z1; z++)
    for (let x = x0; x < x1; x++) {
      const px = ox + x * zoom;
      const py = oy + z * zoom;
      const idx = layer?.[x + z * sx] ?? -1;
      if (idx < 0) {
        // Пустая клетка: блок слоя ниже — бледно, чтобы видеть, на что опирается слой
        const b = ghost ? (below?.[x + z * sx] ?? -1) : -1;
        if (b >= 0) {
          const bst = stateOf(s, b);
          const name = names[bst];
          const eff = name && effective(name);
          if (eff && eff !== REMOVE && !EMPTY_BLOCKS.has(eff)) drawBlock(eff, bst, px, py, 0.18);
        }
        continue;
      }
      const st = stateOf(s, idx);
      const name = names[st];
      if (!name) continue;
      const eff = stroke?.has(idx) ? REMOVE : effective(name);
      if (eff === REMOVE) {
        ctx.strokeStyle = danger;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = Math.max(1, zoom / 12);
        ctx.beginPath();
        ctx.moveTo(px + zoom * 0.25, py + zoom * 0.25);
        ctx.lineTo(px + zoom * 0.75, py + zoom * 0.75);
        ctx.moveTo(px + zoom * 0.75, py + zoom * 0.25);
        ctx.lineTo(px + zoom * 0.25, py + zoom * 0.75);
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      if (EMPTY_BLOCKS.has(eff)) {
        // Явный воздух (расчищает место при вставке) — точка
        if (zoom >= 6) {
          ctx.fillStyle = color('--text-3');
          ctx.globalAlpha = 0.5;
          ctx.fillRect(px + zoom / 2 - 1, py + zoom / 2 - 1, 2, 2);
          ctx.globalAlpha = 1;
        }
        continue;
      }
      drawBlock(eff, st, px, py, 1);
      if (eff !== name && zoom >= 10) {
        // Блок с общей заменой — уголок
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.moveTo(px + zoom, py);
        ctx.lineTo(px + zoom, py + zoom * 0.3);
        ctx.lineTo(px + zoom * 0.7, py);
        ctx.fill();
      }
      const facing = FACING[props[st]?.get('facing') ?? props[st]?.get('horizontal_facing') ?? ''];
      if (facing && zoom >= 18) {
        // Стрелка направления (facing) к краю клетки
        const [dx, dz] = facing;
        const cx0 = px + zoom / 2 + dx * zoom * 0.3;
        const cz0 = py + zoom / 2 + dz * zoom * 0.3;
        const w = zoom * 0.14;
        ctx.beginPath();
        ctx.moveTo(cx0 + dx * w, cz0 + dz * w);
        ctx.lineTo(cx0 - dx * w + dz * w, cz0 - dz * w + dx * w);
        ctx.lineTo(cx0 - dx * w - dz * w, cz0 - dz * w - dx * w);
        ctx.closePath();
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
      }
      if (highlight && eff === highlight) {
        ctx.strokeStyle = color('--imp-2');
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 1, py + 1, zoom - 2, zoom - 2);
      }
    }

  // Сетка
  if (zoom >= 8) {
    ctx.strokeStyle = color('--border');
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x <= x1; x++) {
      const px = Math.round(ox + x * zoom) + 0.5;
      ctx.moveTo(px, oy + z0 * zoom);
      ctx.lineTo(px, oy + z1 * zoom);
    }
    for (let z = z0; z <= z1; z++) {
      const py = Math.round(oy + z * zoom) + 0.5;
      ctx.moveTo(ox + x0 * zoom, py);
      ctx.lineTo(ox + x1 * zoom, py);
    }
    ctx.globalAlpha = 0.6;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = color('--border-strong');
  ctx.lineWidth = 1.5;
  ctx.strokeRect(ox, oy, sx * zoom, sz * zoom);

  // Оси: x — над схемой, z — слева (при сдвиге прижаты к краю окна); подпись не чаще ~26 px
  const step = [1, 2, 5, 10, 20, 50, 100].find((n) => n * zoom >= 26) ?? 200;
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = color('--text-3');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const ax = Math.max(12, Math.min(box.h, oy - 3));
  for (let x = Math.ceil(x0 / step) * step; x < x1; x += step) ctx.fillText(String(x), ox + (x + 0.5) * zoom, ax);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const az = Math.max(22, Math.min(box.w, ox - 4));
  for (let z = Math.ceil(z0 / step) * step; z < z1; z += step) ctx.fillText(String(z), az, oy + (z + 0.5) * zoom);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('x →', Math.max(2, Math.min(box.w - 30, ox + sx * zoom + 6)), ax);
  ctx.textBaseline = 'top';
  ctx.fillText('z ↓', Math.max(2, az - 18), Math.max(2, Math.min(box.h - 12, oy + sz * zoom + 4)));

  // Выделение — заливка и рамка поверх блока (и поверх воздуха и убранных)
  if (selected.size && layer) {
    ctx.fillStyle = accent;
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1, Math.min(3, zoom / 8));
    for (let z = z0; z < z1; z++)
      for (let x = x0; x < x1; x++) {
        if (!selected.has(layer[x + z * sx])) continue;
        const px = ox + x * zoom;
        const py = oy + z * zoom;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(px, py, zoom, zoom);
        ctx.globalAlpha = 1;
        ctx.strokeRect(px + 1, py + 1, zoom - 2, zoom - 2);
      }
  }

  const outline = (c: { x: number; z: number } | null, col: string) => {
    if (!c) return;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + c.x * zoom + 1, oy + c.z * zoom + 1, zoom - 2, zoom - 2);
  };
  outline(hover, color('--text'));
  outline(menu, accent);

  if (area) {
    // Рамка выделения: пунктир, при снятии — красный
    const col = area.off ? danger : accent;
    const rx = ox + Math.min(area.x0, area.x1) * zoom;
    const rz = oy + Math.min(area.z0, area.z1) * zoom;
    const rw = (Math.abs(area.x1 - area.x0) + 1) * zoom;
    const rh = (Math.abs(area.z1 - area.z0) + 1) * zoom;
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(rx, rz, rw, rh);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(rx + 1, rz + 1, rw - 2, rh - 2);
    ctx.setLineDash([]);
  }
}
