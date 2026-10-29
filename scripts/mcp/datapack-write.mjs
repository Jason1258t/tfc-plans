/**
 * Запись датапаков сайта (Firestore datapacks) из MCP (datapack_put) и разовых скриптов (`--upload`): сборка записей,
 * проверки перед записью и сама запись с условием ревизии.
 *
 * Проверки — те же, что показывает редактор датапака на сайте (src/lib/datapack.ts: validatePack, staleIssues,
 * kubejsIssues): структурные берём из общего packages/core/src/datapackFiles.ts, сверку со сборкой повторяем на данных MCP
 * (data.mjs), потому что модули сайта тянут fetch и React. Поменяли проверку на сайте — поменяйте и здесь.
 */
import { randomUUID } from 'node:crypto';
import { datapackIssues } from '@tfc/core/datapackFiles';
import { recipeHash } from '@tfc/core/hash';
import { collectRefs, recipeRefs } from '@tfc/core/recipeRefs';
import { datapackRecipe, getTag, items, readJson, recipeRecord, recipes } from './data.mjs';
import { createDoc, listAll, patchDoc } from './firestore.mjs';

export const KINDS = ['add', 'replace', 'remove', 'file'];
const TAG_KINDS = ['item', 'fluid', 'block', 'entity_type'];
const TAG_LABEL = { item: 'предметы', fluid: 'жидкости', block: 'блоки', entity_type: 'существа' };
const NAMESPACE = /^[a-z0-9_.-]+$/;
// Лимиты правил Firestore (firestore.rules, match /datapacks) и размера документа (1 МиБ)
const MAX_NAME = 80;
const MAX_ENTRIES = 300;
const MAX_BYTES = 1_000_000;

/** id записи — как uid() сайта (src/shared/lib/util.ts) */
export const entryId = () => randomUUID().replaceAll('-', '').slice(0, 12);

const tagFromPath = (path) => {
  const m = /^data\/([a-z0-9_.-]+)\/tags\/(item|fluid|block|entity_type)\/(.+)\.json$/.exec(path);
  return m ? { kind: m[2], id: `${m[1]}:${m[3]}` } : null;
};

const isRemovalJson = (j) =>
  j &&
  typeof j === 'object' &&
  (Object.keys(j).length === 0 ||
    (Array.isArray(j['neoforge:conditions']) && j['neoforge:conditions'].some((c) => c?.type === 'neoforge:false')));

/**
 * Запись датапака из того, что передал агент: { path, content (текст или объект → JSON), kind?, note?, sourceRecipe? }.
 * prev — прежняя запись с тем же путём (её id и поля сохраняются). kind по умолчанию: не рецепт — file; заглушка
 * neoforge:false — remove; путь рецепта, который уже есть в сборке, — replace; иначе add.
 */
export function makeEntry(input, prev = null) {
  const path = String(input.path ?? '').trim();
  const content =
    input.content == null
      ? (prev?.content ?? '')
      : typeof input.content === 'string'
        ? input.content
        : JSON.stringify(input.content, null, 2);
  const r = datapackRecipe(path, content);
  let kind = input.kind ?? (prev?.path === path ? prev.kind : null);
  if (!kind) kind = !r ? 'file' : isRemovalJson(r.j) ? 'remove' : recipes().byId.has(r.i) ? 'replace' : 'add';
  const e = { ...(prev ?? {}), id: prev?.id ?? entryId(), kind, path, content };
  if (r?.t) e.recipeType = r.t;
  else delete e.recipeType;
  if (input.note !== undefined) {
    if (input.note) e.note = String(input.note);
    else delete e.note;
  }
  let src = input.sourceRecipe !== undefined ? input.sourceRecipe : e.sourceRecipe;
  if (src === undefined && r && (kind === 'replace' || kind === 'remove') && recipes().byId.has(r.i)) src = r.i;
  if (src) {
    e.sourceRecipe = String(src);
    // Отпечаток исходника — заново, если исходник сменили или его не было (как entryFromRecipe на сайте)
    if (input.sourceRecipe !== undefined || !e.sourceHash) {
      const orig = recipes().byId.get(e.sourceRecipe);
      if (orig) e.sourceHash = recipeHash(orig.j);
      else delete e.sourceHash;
    }
  } else {
    delete e.sourceRecipe;
    delete e.sourceHash;
  }
  return e;
}

/**
 * Проверка датапака перед записью → { errors, warnings } (списки строк «путь: что не так»).
 * errors — запись невозможна или файл не загрузится; warnings — как подсказки редактора сайта.
 */
export function checkDatapack(pack) {
  const errors = [];
  const warnings = [];
  const name = String(pack.name ?? '').trim();
  if (!name || name.length > MAX_NAME) errors.push(`имя: 1…${MAX_NAME} символов`);
  if (!NAMESPACE.test(pack.namespace ?? '')) errors.push('namespace: только a-z 0-9 _ . -');
  const entries = pack.entries ?? [];
  if (entries.length > MAX_ENTRIES)
    errors.push(`записей ${entries.length}, больше ${MAX_ENTRIES} не пропустит Firestore`);
  for (const e of entries) if (!KINDS.includes(e.kind)) errors.push(`${e.path}: kind — ${KINDS.join(' / ')}`);
  for (const i of datapackIssues(entries)) errors.push(`${i.path}: ${i.message}`);
  const bytes = Buffer.byteLength(JSON.stringify(pack));
  if (bytes > MAX_BYTES) errors.push(`документ ${Math.round(bytes / 1024)} КБ — больше 1 МБ Firestore не хранит`);

  const cat = recipes();
  const itemIndex = items();
  const ownTags = new Set(
    entries.flatMap((e) => {
      const t = tagFromPath(e.path);
      return t && ['item', 'fluid'].includes(t.kind) ? [t.id] : [];
    }),
  );
  for (const e of entries) {
    const r = datapackRecipe(e.path, e.content);
    if (e.sourceRecipe) {
      const orig = cat.byId.get(e.sourceRecipe);
      if (!orig) warnings.push(`${e.path}: рецепта ${e.sourceRecipe} больше нет в сборке`);
      else if (e.sourceHash && recipeHash(orig.j) !== e.sourceHash && e.kind !== 'remove')
        warnings.push(
          `${e.path}: ${e.kind === 'add' ? 'шаблон' : 'оригинал'} ${e.sourceRecipe} изменился в сборке — сверьте с новой версией`,
        );
    }
    if (r && (e.kind === 'replace' || e.kind === 'remove') && !cat.byId.has(r.i) && e.sourceRecipe !== r.i)
      warnings.push(
        `${e.path}: рецепта ${r.i} в сборке нет — ${e.kind === 'remove' ? 'отключать' : 'заменять'} нечего`,
      );
    if (r && e.kind === 'add' && cat.byId.has(r.i))
      warnings.push(`${e.path}: рецепт ${r.i} уже есть в сборке — этот файл его заменит (kind replace)`);
    if (!e.path.endsWith('.json') || tagFromPath(e.path)) continue;
    let json;
    try {
      json = JSON.parse(e.content);
    } catch {
      continue; // синтаксис — в errors
    }
    if (r && e.kind !== 'remove') {
      const rec = recipeRecord({ ...r, s: 'site' }, 'site-datapack', cat.rules);
      if (rec.kjsRemoved.length)
        warnings.push(
          `${e.path}: этот рецепт удаляет KubeJS (правила ${rec.kjsRemoved.join(', ')}) — в игре его не будет`,
        );
    }
    // Жидкости (tfc:metal/copper, …fluid…) и ваниль не проверяем: их нет в библиотеке предметов
    const outs = new Set();
    const ins = new Set();
    collectRefs(json, false, outs, ins);
    const missing = [...new Set([...outs, ...ins])].filter(
      (id) =>
        !id.startsWith('#') &&
        !itemIndex.byId.has(id) &&
        !id.startsWith('minecraft:') &&
        !/:metal\/[a-z_]+$|fluid/.test(id),
    );
    if (missing.length)
      warnings.push(`${e.path}: нет в сборке: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`);
    // Рецепт берёт теги предметов или жидкостей; тег блоков с тем же именем ему не подходит — ячейка пустая
    const { inputs, outputs } = recipeRefs(json);
    for (const ref of new Set([...inputs, ...outputs])) {
      if (!ref.startsWith('#')) continue;
      const id = ref.slice(1);
      if (ownTags.has(id)) continue;
      const kinds = TAG_KINDS.filter((k) => getTag(k, id));
      if (kinds.includes('item') || kinds.includes('fluid')) continue;
      warnings.push(
        kinds.length
          ? `${e.path}: тег #${id} есть только у вида «${kinds.map((k) => TAG_LABEL[k]).join('», «')}», а рецепт берёт теги предметов и жидкостей — в игре на этом месте будет пусто`
          : `${e.path}: тега #${id} в сборке нет — в игре на этом месте будет пусто`,
      );
    }
  }
  return { errors, warnings };
}

/**
 * Подтверждённая версия в сборке (kubejs.json → datapacks, dev #125): правка карточки её не меняет.
 * Текст — как плашка «В сборке» в редакторе сайта; null — датапак в сборку не закреплён.
 */
export function deploymentNote(id) {
  const d = id && (readJson('kubejs.json', {}).datapacks ?? []).find((p) => p.id === id);
  if (!d) return null;
  return [
    `⚠ Датапак закреплён в сборке: ${d.path}, версия ${String(d.contentHash).slice(0, 12)}, подтвердил ${d.confirmedBy}.`,
    'Правка карточки сайта эту версию не меняет — игроки получают прежний проверенный ZIP.',
    `Чтобы проверить новую версию в мире, хост сначала выполняет tfc datapacks unconfirm ${id}, затем после проверки — confirm.`,
  ].join('\n');
}

/**
 * Записать датапак: без id — новый документ (author, createdAt), с id — только переданные поля при условии,
 * что документ не менялся с ревизии base (updateTime). → { id, updateTime }.
 */
export async function saveDatapack({ id, base, fields, nick }) {
  const now = Date.now();
  const data = { ...fields, updatedBy: nick, updatedAt: now };
  if (!id) {
    const r = await createDoc('datapacks', {
      description: '',
      install: false,
      ...data,
      author: nick,
      createdAt: now,
    });
    return r;
  }
  if (!base) throw new Error('нужна ревизия документа (updateTime), иначе запись может затереть чужую правку');
  return { id, updateTime: await patchDoc('datapacks', id, data, base) };
}

/**
 * Для разовых скриптов (`--upload`): датапак с этим именем на сайте создать или заменить его поля
 * name/namespace/description/entries. Проверка перед записью; ошибки — исключение, предупреждения — в ответе.
 * Отметку «ставить» не трогает. → { id, created, updateTime, warnings, deployment }.
 */
export async function uploadDatapack(pack, nick) {
  const docs = await listAll('datapacks', ['name', 'entries']);
  const existing = docs.find((d) => d.name === pack.name);
  // id записей с тем же путём сохраняем, чтобы сайт видел ту же запись, а не новую
  const prevByPath = new Map((existing?.entries ?? []).map((e) => [e.path, e]));
  const entries = pack.entries.map((e) => ({ ...e, id: prevByPath.get(e.path)?.id ?? e.id ?? entryId() }));
  const fields = { name: pack.name, namespace: pack.namespace, description: pack.description ?? '', entries };
  const { errors, warnings } = checkDatapack(fields);
  if (errors.length) throw new Error(`датапак не записан:\n${errors.join('\n')}`);
  const r = await saveDatapack({ id: existing?.id, base: existing?.updateTime, fields, nick });
  return { ...r, created: !existing, warnings, deployment: deploymentNote(r.id) };
}
