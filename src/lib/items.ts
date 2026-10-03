import { useEffect, useState } from 'react';

/** Запись библиотеки предметов (см. scripts/build-items.mjs) */
export interface McItem {
  /** id: tfc:metal/ingot/copper */
  i: string;
  /** Имя en_us */
  e: string;
  /** Имя ru_ru (если отличается) */
  r?: string;
  /** Путь иконки внутри /icons без .png */
  t?: string;
}

export interface ItemIndex {
  list: McItem[];
  byId: Map<string, McItem>;
}

let indexPromise: Promise<ItemIndex> | null = null;
let loaded: ItemIndex | null = null;

export function loadItems(): Promise<ItemIndex> {
  indexPromise ??= fetch(`${import.meta.env.BASE_URL}items.json`)
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => [])
    .then((list: McItem[]) => {
      // Подавляем «технические» предметы
      list = list.filter((it) => it.i !== 'minecraft:air');
      loaded = { list, byId: new Map(list.map((it) => [it.i, it])) };
      return loaded;
    });
  return indexPromise;
}

export function useItems(): ItemIndex | null {
  const [idx, setIdx] = useState(loaded);
  useEffect(() => {
    if (!idx) loadItems().then(setIdx);
  }, [idx]);
  return idx;
}

export const itemName = (it: McItem | undefined, fallbackId?: string) => (it ? (it.r ?? it.e) : (fallbackId ?? '?'));

export const iconUrl = (it: McItem | undefined) => (it?.t ? `${import.meta.env.BASE_URL}icons/${it.t}.png` : null);

export const textureUrl = (path: string) => `${import.meta.env.BASE_URL}icons/${path}.png`;

const norm = (s: string) => s.toLowerCase().replaceAll('ё', 'е');

/**
 * Поиск по русскому/английскому имени и id. Каждое слово запроса должно найтись.
 * Ранжирование: начало имени > начало слова > вхождение; предметы TFC выше ванили
 * (в TFC многие ванильные предметы не используются).
 */
export function searchItems(idx: ItemIndex, query: string, limit = 30): McItem[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: { it: McItem; score: number }[] = [];
  for (const it of idx.list) {
    const ru = norm(it.r ?? '');
    const en = norm(it.e);
    const id = it.i;
    let score = 0;
    let ok = true;
    for (const w of words) {
      const hay = [ru, en, id];
      let best = -1;
      for (const h of hay) {
        const pos = h.indexOf(w);
        if (pos === -1) continue;
        const s = pos === 0 ? 30 : /[\s/:_]/.test(h[pos - 1]) ? 20 : 8;
        best = Math.max(best, s);
      }
      if (best < 0) {
        ok = false;
        break;
      }
      score += best;
    }
    if (!ok) continue;
    if (!id.startsWith('minecraft:')) score += 6;
    // Короткие имена обычно «базовые» предметы — поднимаем их
    score -= (it.r ?? it.e).length / 10;
    scored.push({ it, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.it);
}

/** Лучшее совпадение для свободного названия (используется при разборе ответа Gemini) */
export function matchItem(idx: ItemIndex, name: string): McItem | undefined {
  const exact = idx.list.find((it) => norm(it.r ?? '') === norm(name) || norm(it.e) === norm(name));
  return exact ?? searchItems(idx, name, 1)[0];
}
