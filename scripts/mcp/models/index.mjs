/**
 * Реестр того, что игра рисует кодом, а не моделью из файла: по модулю на мод (группу), движок — render.mjs.
 *
 * Модуль группы — { name, loaders?, flat?, items?, objCallbacks? }:
 *   loaders: { '<загрузчик модели>': (ctx, part) → [части] } — геометрия загрузчика (composite, конвейеры IE…);
 *   flat:    { '<загрузчик>': (ctx, model, itemId) → { specs, fluid?, wanted? } } — плоский предмет слоями (вёдра);
 *   items:   [{ name, match(id, chain) → bool, build(ctx, id, own) → { quads } | { parts } | null }] — предметы
 *            builtin/entity (рендерер предмета в коде): quads — грани модели сущности, parts — модели блоков;
 *   objCallbacks: { '<callbacks ie_obj>': { show(group), texture?, tint?(group) } } — видимые группы OBJ.
 * ctx — помощники движка (modelContext в render.mjs): ресурсы, раскрытие вложенных частей, предупреждения.
 *
 * Обработчик, который упал или не узнал данные (мод обновился), не роняет сборку: его ответ — «не умею» (null),
 * предмет остаётся текстурой, в предупреждения — причина. Новый мод — файл группы + строка в GROUPS.
 */
import computercraft from './computercraft.mjs';
import createSubmarine from './create_submarine.mjs';
import cuisinedelight from './cuisinedelight.mjs';
import functionalstorage from './functionalstorage.mjs';
import immersiveengineering from './immersiveengineering.mjs';
import minecraft from './minecraft.mjs';
import neoforge from './neoforge.mjs';
import sophisticatedbackpacks from './sophisticatedbackpacks.mjs';
import tfc from './tfc.mjs';

const GROUPS = [
  neoforge,
  minecraft,
  tfc,
  immersiveengineering,
  functionalstorage,
  computercraft,
  sophisticatedbackpacks,
  cuisinedelight,
  createSubmarine,
];

const LOADERS = new Map();
const FLAT = new Map();
const ITEMS = [];
const OBJ_CALLBACKS = new Map();
for (const g of GROUPS) {
  for (const [k, fn] of Object.entries(g.loaders ?? {})) LOADERS.set(k, { fn, group: g.name });
  for (const [k, fn] of Object.entries(g.flat ?? {})) FLAT.set(k, { fn, group: g.name });
  for (const it of g.items ?? []) ITEMS.push({ ...it, group: g.name });
  for (const [k, cb] of Object.entries(g.objCallbacks ?? {})) OBJ_CALLBACKS.set(k, cb);
}

/** Вызов обработчика: исключение → предупреждение и null («не умею») */
function safe(ctx, label, fn) {
  try {
    return fn() ?? null;
  } catch (e) {
    ctx?.warn?.(`${label}: обработчик упал (${e.message}) — остаётся текстурой`);
    return null;
  }
}

/** Загрузчики, геометрию которых раскрывает реестр */
export const registryLoaders = () => [...LOADERS.keys()];

/** Части загрузчика model.loader или null (загрузчик не наш или обработчик не справился) */
export function expandLoader(ctx, part) {
  const h = LOADERS.get(part.model.loader ?? '');
  return h ? safe(ctx, `${h.group}: ${part.model.loader}`, () => h.fn(ctx, part)) : null;
}

/** Плоский предмет с загрузчиком: { specs, fluid?, wanted? } или null */
export function flatLoader(ctx, model, itemId) {
  const h = FLAT.get(model.loader ?? '');
  return h ? safe(ctx, `${h.group}: ${model.loader}`, () => h.fn(ctx, model, itemId)) : null;
}

/** Видимость и окраска групп OBJ по полю callbacks (ie_obj) или undefined */
export const objCallback = (name) => OBJ_CALLBACKS.get(name);

/**
 * Предмет builtin/entity: { quads, drawnBy } (грани модели сущности) или { parts, drawnBy } (модели блоков с
 * поворотами) или null — такого рендерера в реестре нет.
 */
export function codeItemModel(ctx, id, own) {
  if (!own?.entity) return null;
  const chain = own.chain.map((c) => c.id);
  for (const h of ITEMS) {
    if (!safe(ctx, `${h.group}: ${h.name}`, () => h.match(id, chain))) continue;
    const r = safe(ctx, `${h.group}: ${h.name}`, () => h.build(ctx, id, own));
    if (r) return { ...r, drawnBy: r.drawnBy ?? h.name };
  }
  return null;
}
