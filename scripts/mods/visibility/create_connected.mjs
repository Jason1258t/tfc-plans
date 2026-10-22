/**
 * Create Connected: блоки и предметы с FeatureToggle.addCondition(() -> Mods.X.isLoaded() …) регистрируются всегда,
 * но при ложном условии мод убирает их из творческого и JEI (FeatureToggle.refreshItemVisibility) — в игре их не
 * видно (катализаторы для Dragons Plus, Garnished, Dye Depot и т. п.). Условие вычисляется по байткоду лямбды
 * с modId из перечисления Mods; имя — строка, переданная в REGISTRATE.block/item перед условием (склеенное имя
 * цикла — шаблоном). Настройки мода (выключенные игроком функции) не учитываются.
 */
import { instructions } from '../classfile.mjs';
import { evalSupplier, registrationNameBefore } from './bytecode.mjs';

export default {
  name: 'Create Connected (FeatureToggle)',
  mod: 'create_connected',
  hidden(set) {
    const jar = set.jarOf('create_connected');
    if (!jar) return { entries: [] };
    const names = set.classNames(jar);
    const toggle = names.find((n) => /\/FeatureToggle$/.test(n));
    if (!toggle) return { entries: [], warnings: ['нет класса FeatureToggle — правило устарело'] };
    const entries = [];
    const warnings = [];
    const isRegister = (r) => r.name === 'block' || r.name === 'item';
    for (const name of names) {
      const cls = set.cls(jar, name);
      for (const m of cls?.methods ?? []) {
        if (!m.code) continue;
        const ins = instructions(m.code);
        ins.forEach((i, k) => {
          if (i.op !== 0xb8) return;
          const r = cls.ref(i.index);
          if (r.owner !== toggle || r.name !== 'addCondition' || !r.desc.startsWith('(Ljava/util/function/Supplier;)'))
            return;
          const ok = evalSupplier(set, jar, cls, ins, k - 1);
          if (ok !== false) return; // истинно или не вычислилось — предмет виден
          const who = registrationNameBefore(cls, ins, k, isRegister);
          if (!who) warnings.push(`${name}.${m.name}: условие ложно, но имя предмета не найдено`);
          else
            entries.push({
              ...(who.exact ? { id: `create_connected:${who.exact}` } : { pattern: who.pattern }),
              why: 'Create Connected выключает (условие FeatureToggle: нужного мода нет в сборке)',
            });
        });
      }
    }
    return { entries, warnings };
  },
};
