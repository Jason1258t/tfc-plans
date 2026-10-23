/**
 * recipe_conflicts — перехват нового рецепта уже существующим (или наоборот) в сборке: моды, KubeJS, датапаки сайта.
 * Сравнивает входы рецептов одного типа: бесформенный — тот же набор входов (с учётом тегов), shaped — та же сетка
 * (с учётом зеркала). Тег и предмет пересекаются, если предмет состоит в теге; тег, которого нет в индексе тегов,
 * ничего не покрывает (пустой тег). Отдельно: рецепт с тем же id — новый его заменит в слое поверх.
 */
import { recipeRefs } from '../../../src/lib/recipeRefs.ts';
import { siteRecipes } from '../site-datapacks.mjs';
import { directMembers, flattenTag, getTag, isActive, recipeStatus, tags } from '../data.mjs';
import { named, paging, short, str } from '../fmt.mjs';

const KINDS = ['item', 'fluid'];

/** Предметы/жидкости, которые покрывает вход; тег раскрывается по обоим видам. found=false — тега нет в индексе */
function refMembers(ref) {
  if (!ref.startsWith('#')) return { found: true, set: new Set([ref]) };
  const id = ref.slice(1);
  const set = new Set();
  let found = false;
  for (const kind of KINDS) {
    const t = getTag(kind, id);
    if (!t) continue;
    found = true;
    for (const m of flattenTag(tags(), kind, directMembers(t))) set.add(m);
  }
  return { found, set };
}

/** Пересекаются ли входы: предмет ≡ предмет, предмет ∈ тег, тег ∩ тег. Тег без состава ничего не покрывает */
function overlap(a, b) {
  if (a === b) return true;
  const ma = refMembers(a);
  const mb = refMembers(b);
  if (a.startsWith('#') && !ma.found) return false;
  if (b.startsWith('#') && !mb.found) return false;
  for (const x of ma.set) if (mb.set.has(x)) return true;
  return false;
}

/** Точное биективное сопоставление входов (порядок не важен): каждый вход находит непересекающуюся пару */
function matchAll(a, b) {
  if (a.length !== b.length) return false;
  const used = new Array(b.length).fill(false);
  const dfs = (i) => {
    if (i === a.length) return true;
    for (let j = 0; j < b.length; j++) {
      if (used[j]) continue;
      if (!overlap(a[i], b[j])) continue;
      used[j] = true;
      if (dfs(i + 1)) return true;
      used[j] = false;
    }
    return false;
  };
  return dfs(0);
}

const isShaped = (j) => Array.isArray(j?.pattern) && j?.key && typeof j.key === 'object';

function gridOf(j) {
  const key = j.key;
  return j.pattern.map((row) =>
    [...row].map((ch) => {
      if (ch === ' ') return null;
      const k = key[ch];
      if (k == null) return ch; // символ без ключа — не разобрать
      return typeof k === 'string' ? k : k.tag ? `#${k.tag}` : k.item ?? k;
    }),
  );
}

const mirror = (g) => g.map((r) => [...r].reverse());

function gridEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) return false;
    for (let k = 0; k < a[i].length; k++) {
      const ca = a[i][k];
      const cb = b[i][k];
      if (ca == null && cb == null) continue;
      if (ca == null || cb == null || !overlap(ca, cb)) return false;
    }
  }
  return true;
}

const refs = (list) => (list.length ? list.map(named).join(', ') : '—');

function lineOf(r, reason) {
  const src = r.k
    ? `скрипт KubeJS ${r.s}:${r.k.line}`
    : r.dp
      ? `датапак сайта ${r.dp}`
      : r.s.startsWith('kubejs/')
        ? `датапак ${r.s}`
        : r.s;
  return [
    `• ${r.i} [${r.t || 'заглушка'}] — ${recipeStatus(r)}; ${src}`,
    `  выход: ${short(refs(r.outputs), 300)}`,
    `  вход: ${short(refs(r.inputs), 300)}`,
    `  ${reason}`,
  ];
}

function parseRecipe(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    throw new Error('recipe — не JSON');
  }
}

async function recipeConflicts(a) {
  const json = parseRecipe(a.recipe);
  const cand = {
    id: String(a.id ?? '').trim() || null,
    type: String(a.type ?? '').trim() || (json?.type ? String(json.type) : ''),
    inputs: (Array.isArray(a.inputs) ? a.inputs.map((x) => String(x).trim()) : []).filter(Boolean),
    outputs: (Array.isArray(a.outputs) ? a.outputs.map((x) => String(x).trim()) : []).filter(Boolean),
    json,
  };

  const site = await siteRecipes();
  const cat = site.cat;

  // Только id существующего рецепта — берём его тип, входы, выходы и JSON
  if (!cand.json && !cand.inputs.length && !cand.outputs.length && cand.id) {
    const ex = cat.byId.get(cand.id) ?? site.other?.byId.get(cand.id);
    if (!ex) return `Рецепта ${cand.id} нет в сборке (recipes_for / recipe_get).`;
    cand.type = cand.type || ex.t || '';
    cand.inputs.push(...ex.inputs.filter((x) => !cand.inputs.includes(x)));
    cand.outputs.push(...ex.outputs.filter((x) => !cand.outputs.includes(x)));
    cand.json = ex.j;
  }
  if (cand.json) {
    if (!cand.id && typeof cand.json.id === 'string') cand.id = cand.json.id;
    const r = recipeRefs(cand.json);
    cand.inputs.push(...r.inputs.filter((x) => !cand.inputs.includes(x)));
    cand.outputs.push(...r.outputs.filter((x) => !cand.outputs.includes(x)));
  }
  if (!cand.type) throw new Error('нужен type (или поле type в recipe JSON)');
  if (!cand.id && !cand.inputs.length && !cand.outputs.length) throw new Error('дайте recipe (JSON), inputs или id существующего рецепта');

  const same = cat.list.filter((r) => r.t === cand.type || r.t.endsWith(`:${cand.type}`)).filter(isActive);
  const out = [
    `Проверка конфликтов: тип ${cand.type}${cand.id ? `, id ${cand.id}` : ''}.`,
    `Кандидат — выход: ${refs(cand.outputs)}; вход: ${refs(cand.inputs)}`,
    `Активных рецептов этого типа в сборке: ${same.length}.`,
  ];

  const conflicts = [];
  const sameId = [];
  for (const r of same) {
    if (cand.id && r.i === cand.id) {
      sameId.push(r);
      continue;
    }
    let clash = false;
    if (cand.json && isShaped(cand.json) && isShaped(r.j ?? {})) {
      const g = gridOf(cand.json);
      clash = gridEqual(g, gridOf(r.j)) || gridEqual(g, mirror(gridOf(r.j)));
    } else {
      clash = matchAll(cand.inputs, r.inputs);
    }
    if (clash) conflicts.push(r);
  }

  if (sameId.length)
    out.push(
      '',
      '== Тот же id (новый рецепт заменит его) ==',
      ...sameId.flatMap((r) => lineOf(r, '— тот же id: в слое поверх (датапак/KubeJS) перезапишет этот рецепт')),
    );
  if (conflicts.length)
    out.push(
      '',
      '== Конфликты: тот же набор входов / та же сетка (с учётом тегов и зеркала) ==',
      ...conflicts.flatMap((r) =>
        lineOf(
          r,
          cand.json && isShaped(cand.json) && isShaped(r.j ?? {})
            ? '— та же сетка: перехватит или будет перехвачен'
            : '— тот же набор входов: перехватит или будет перехвачен',
        ),
      ),
    );
  if (!sameId.length && !conflicts.length) out.push('', 'Конфликтов не найдено.');
  if (site.note) out.push('', site.note);
  return out.join('\n');
}

export const TOOLS = [
  {
    name: 'recipe_conflicts',
    description:
      'Would a new recipe be intercepted by (or intercept) an existing recipe of the same type: shapeless — same input set (tags considered), shaped — same grid (mirror considered). Item vs tag overlap = item is a tag member; a tag absent from the tag index matches nothing. A recipe with the same id (would be replaced) is listed separately. Sources: mods, kubejs/data, KubeJS scripts, site datapacks (KubeJS removals applied). Give type + recipe JSON (or inputs/outputs) or an existing recipe id.',
    inputSchema: {
      type: 'object',
      properties: {
        type: str('recipe type, e.g. create:mixing or tfc:anvil (from recipe JSON or an existing id if omitted)'),
        recipe: str('recipe JSON (object or string); inputs/outputs are taken from it'),
        id: str('recipe id ns:path — for the same-id note, or to check an existing recipe'),
        inputs: { type: 'array', items: { type: 'string' }, description: 'input item/fluid ids; tags as «#c:…»' },
        outputs: { type: 'array', items: { type: 'string' }, description: 'output ids (optional, for the header)' },
        ...paging,
      },
    },
    handler: recipeConflicts,
  },
];
