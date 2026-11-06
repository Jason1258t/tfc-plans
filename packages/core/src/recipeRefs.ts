/**
 * Предметы на входе и выходе рецепта по его JSON. Без импортов: используется и сайтом,
 * и scripts/kubejs.mjs (Node запускает .ts напрямую).
 */

/** id предмета или жидкости; в аргументах хелперов KubeJS бывает с количеством и тегом: «4x mod:item», «#c:tag» */
const REF_RE = /^(?:\d+x\s+)?(#?)([a-z0-9_.-]+:[a-z0-9_./-]+)$/;
/** Ключи, где лежат служебные строки, а не предметы */
const NON_ITEM_KEYS = new Set([
  'type',
  'mode',
  'knapping_type',
  'sound',
  'texture',
  'input_texture',
  'output_texture',
  'category',
  'group',
  'trait',
  'modid',
  'feature',
  'bonus',
]);

export function collectRefs(node: unknown, isOut: boolean, outs: Set<string>, ins: Set<string>, key = '') {
  if (typeof node === 'string') {
    const m = NON_ITEM_KEYS.has(key) ? null : REF_RE.exec(node);
    if (!m) return;
    const isTag = m[1] || key === 'tag' || key === 'fluid_tag' || key === 'fluidTag';
    const ref = isTag ? `#${m[2]}` : m[2];
    (isOut ? outs : ins).add(ref);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectRefs(v, isOut, outs, ins, key);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'neoforge:conditions' || k === 'conditions' || k === 'rules' || k === 'operations') continue;
      const out = isOut || /result|output|transitional/i.test(k);
      collectRefs(v, out, outs, ins, k);
    }
  }
}

/** Входы и выходы рецепта: id предметов/жидкостей, теги — с «#» */
export function recipeRefs(json: unknown): { inputs: string[]; outputs: string[] } {
  const outs = new Set<string>();
  const ins = new Set<string>();
  collectRefs(json, false, outs, ins);
  return { inputs: [...ins], outputs: [...outs] };
}
