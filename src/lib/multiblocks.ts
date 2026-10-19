import { useEffect, useState } from 'react';
import { directMembers, flattenTag, type TagCatalog } from './tags';

/**
 * Мультиблоки IE и Advanced TFC Tech (public/multiblocks.json, scripts/mods/multiblocks.mjs): шаблон структуры,
 * блок для удара молотом, текст книги IE. Координаты шаблона: x — вправо, y — вверх, z — к игроку
 * (лицевая сторона шаблона — юг, +Z: так IE поворачивает структуру к стороне, по которой ударили).
 */

export interface MbBlockState {
  id: string;
  /** Свойства блока (type у плит, facing…) */
  p?: Record<string, string>;
}

/** [x, y, z, номер в палитре] — без воздуха */
export type MbBlock = [number, number, number, number];

export interface MbManual {
  entry: string;
  ns: string;
  jar: string;
  lang: 'ru' | 'en';
  title: string;
  subtitle: string;
  /** Абзацы через пустую строку; {config:ключ} — значение из конфига IE */
  text: string;
  /** Английский текст, если показан перевод */
  en?: string;
}

export interface MbShape {
  size: [number, number, number];
  palette: MbBlockState[];
  blocks: MbBlock[];
  nbt: string;
}

export interface Multiblock extends MbShape {
  id: string;
  ns: string;
  name: { en: string; ru: string | null };
  /** Блок машины — для иконки и связи с расходом энергии */
  block: string | null;
  trigger: [number, number, number] | null;
  mirror: boolean;
  /** Свои теги-заменители (бункер, резервуар: любой листовой металл) */
  extraTags?: string[];
  source: string;
  /** Шаблон перекрыт поздним модом: имя jar, который перекрыт */
  replaces?: string;
  manual: MbManual[];
  recipes: { t: string; n: number }[];
  /** Вид целиком (экскаватор с ковшом) */
  extra?: MbShape & { id: string };
}

export interface MultiblockData {
  matchTags: string[];
  list: Multiblock[];
}

let loaded: MultiblockData | null | undefined;
let promise: Promise<MultiblockData | null> | null = null;

/** undefined — грузится, null — файла нет (библиотека собрана старой версией) */
export function useMultiblocks(): MultiblockData | null | undefined {
  const [data, setData] = useState(loaded);
  useEffect(() => {
    promise ??= fetch(`${import.meta.env.BASE_URL}multiblocks.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d: MultiblockData | null) => (loaded = d?.list?.length ? d : null));
    if (data === undefined) promise.then(setData);
  }, [data]);
  return data;
}

export const mbName = (m: Multiblock) => m.name.ru ?? m.name.en;
/** «immersiveengineering:crusher» → «crusher» — короткий адрес, если имя не повторяется у другого мода */
export const mbSlug = (m: Multiblock, list: Multiblock[]) => {
  const short = m.id.split(':')[1];
  return list.filter((x) => x.id.split(':')[1] === short).length > 1 ? m.id : short;
};

export const MOD_LABEL: Record<string, string> = {
  immersiveengineering: 'Immersive Engineering',
  advancedtfctech: 'Advanced TFC Tech',
};

/** Форма блока для объёмного вида: плиты — половина, заборы и столбы — тонкие */
export type MbForm = 'cube' | 'slab-bottom' | 'slab-top' | 'post';
export function blockForm(s: MbBlockState): MbForm {
  const path = s.id.split(':')[1] ?? '';
  if (/(^|_)slab(_|$)/.test(path))
    return s.p?.type === 'top' ? 'slab-top' : s.p?.type === 'double' ? 'cube' : 'slab-bottom';
  if (/fence|_post$/.test(path) && !/gate/.test(path)) return 'post';
  return 'cube';
}

/** Материалы: блок → сколько штук, по убыванию */
export function materials(shape: MbShape): { state: MbBlockState; count: number }[] {
  const byId = new Map<string, { state: MbBlockState; count: number }>();
  for (const b of shape.blocks) {
    const s = shape.palette[b[3]];
    const cur = byId.get(s.id) ?? { state: s, count: 0 };
    cur.count++;
    byId.set(s.id, cur);
  }
  return [...byId.values()].sort((a, b) => b.count - a.count || a.state.id.localeCompare(b.state.id));
}

/**
 * Чем ещё можно заменить блок: IE принимает любой блок из того же тега-заменителя (хранилища и листовой металл
 * по металлам, стальные и алюминиевые леса и заборы, обработанное дерево). Берём самый широкий тег с блоком.
 */
export function alternatives(
  cat: TagCatalog,
  data: MultiblockData,
  m: Multiblock,
  blockId: string,
): { tag: string; members: string[] } | null {
  const patterns = [...data.matchTags, ...(m.extraTags ?? [])];
  let best: { tag: string; members: string[] } | null = null;
  for (const t of cat.list) {
    if (t.k !== 'block') continue;
    if (!patterns.some((p) => (p.endsWith('/') ? t.i.startsWith(p) : t.i === p))) continue;
    const members = flattenTag(cat, 'block', directMembers(t));
    if (!members.includes(blockId)) continue;
    if (!best || members.length > best.members.length) best = { tag: t.i, members };
  }
  return best && best.members.length > 1 ? best : null;
}
