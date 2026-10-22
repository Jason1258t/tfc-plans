/**
 * Предметы, которые есть в ресурсах jar, но игрок их не видит: мод их не регистрирует или прячет из творческого и JEI.
 * Сайт показывает их в библиотеке скрытыми (поле h в items.json — причина): по id они находятся (иконки схем, рецепты),
 * в поиске и списках их нет.
 *
 * Правило — модуль в этой папке: { name, mod, hidden(set) → { entries: [{ id | pattern, why, onlyIfItem? }], warnings } }.
 * Правило читает код своего мода (bytecode.mjs) и при незнакомом коде возвращает предупреждение, а не исключение;
 * упавшее правило пропускается — сборка сайта не останавливается. Новое правило — файл + строка в RULES.
 */
import createConnected from './create_connected.mjs';
import tfc from './tfc.mjs';
import { jarSet } from './bytecode.mjs';

const RULES = [createConnected, tfc];

/** jarPaths — jar сборки, itemIds — id предметов библиотеки. → { hidden: Map(id → причина), warnings: [] } */
export function hiddenItems(jarPaths, itemIds) {
  const set = jarSet(jarPaths);
  const hidden = new Map();
  const warnings = [];
  const ids = [...itemIds];
  for (const rule of RULES) {
    if (!set.loaded.has(rule.mod)) continue;
    let res;
    try {
      res = rule.hidden(set);
    } catch (e) {
      warnings.push(`${rule.name}: правило упало (${e.message}) — пропущено`);
      continue;
    }
    for (const w of res.warnings ?? []) warnings.push(`${rule.name}: ${w}`);
    let n = 0;
    for (const e of res.entries ?? []) {
      const hits = e.id
        ? ids.filter((id) => id === e.id)
        : ids.filter((id) => id.startsWith(`${rule.mod}:`) && e.pattern.test(id.slice(rule.mod.length + 1)));
      for (const id of hits)
        if (!hidden.has(id)) {
          hidden.set(id, e.why);
          n++;
        }
    }
    if (!n && res.entries?.length)
      warnings.push(`${rule.name}: условия есть, но ни один предмет библиотеки не подошёл`);
  }
  return { hidden, warnings };
}
