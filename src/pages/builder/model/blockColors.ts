import { useCallback, useEffect, useState } from 'react';
import { textureStats } from '@tfc/core/building/color';
import { isBuildingBlock, type BlockColors } from '@tfc/core/building/similar';
import { isBlock, textureUrl, type ItemIndex } from '@/shared/pack-data';

/**
 * Цвета блоков для подборщика: файл block-colors.json выкладывает сервер сборки. Пока его нет (сборку ещё не
 * пересобрали), цвета считаются здесь же по текстурам блоков — той же формулой (@tfc/core/building/color).
 * Запасной расчёт не знает, целый ли блок куб: берёт блоки со своей блочной текстурой, и в подборе бывает лишнее.
 */

let published: Promise<BlockColors | null> | null = null;
let computed: BlockColors | null = null;

function loadPublished() {
  published ??= fetch(`${import.meta.env.BASE_URL}block-colors.json`)
    .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : null))
    .catch(() => null);
  return published;
}

async function pixels(url: string): Promise<{ data: Uint8ClampedArray; w: number; h: number } | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const bmp = await createImageBitmap(await res.blob());
  // Анимированные текстуры — полоса кадров: первый квадрат
  const w = bmp.width;
  const h = Math.min(bmp.height, bmp.width);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return { data: ctx.getImageData(0, 0, w, h).data, w, h };
}

async function compute(items: ItemIndex, onProgress: (done: number, total: number) => void): Promise<BlockColors> {
  // Без файла сервера не известно, куб ли блок: берём блоки с нарисованной моделью и своей блочной текстурой
  // (камень, кирпичи, доски) — у механизмов и плоских предметов текстура из item/ или чужая
  const pool = items.list.filter(
    (it) => it.t?.includes('/block/') && it.g && !it.h && isBlock(items, it.i) && isBuildingBlock(it.i),
  );
  const out: BlockColors = { v: 1, b: {} };
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < pool.length) {
      const it = pool[next++];
      try {
        const px = await pixels(textureUrl(it.t!));
        const s = px && textureStats(px.data, px.w, px.h);
        if (s) out.b[it.i] = [s.lab[0], s.lab[1], s.lab[2], s.spread, 1];
      } catch {
        /* битая картинка — блок просто не попадёт в подбор */
      }
      if (++done % 50 === 0 || done === pool.length) onProgress(done, pool.length);
    }
  };
  await Promise.all(Array.from({ length: 12 }, worker));
  return out;
}

export interface ColorsState {
  colors: BlockColors | null;
  /** Файла с сервера нет — можно посчитать в браузере */
  needCompute: boolean;
  progress: { done: number; total: number } | null;
  start: () => void;
}

export function useBlockColors(items: ItemIndex | null): ColorsState {
  const [colors, setColors] = useState<BlockColors | null>(computed);
  const [needCompute, setNeedCompute] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  useEffect(() => {
    if (computed) return;
    let live = true;
    loadPublished().then((c) => {
      if (!live) return;
      if (c) setColors(c);
      else setNeedCompute(true);
    });
    return () => {
      live = false;
    };
  }, []);
  const start = useCallback(() => {
    if (!items || progress) return;
    setProgress({ done: 0, total: 1 });
    compute(items, (done, total) => setProgress({ done, total })).then((c) => {
      computed = c;
      setColors(c);
      setNeedCompute(false);
      setProgress(null);
    });
  }, [items, progress]);
  return { colors, needCompute: needCompute && !colors, progress, start };
}
