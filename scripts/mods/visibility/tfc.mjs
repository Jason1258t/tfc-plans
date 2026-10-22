/**
 * TerraFirmaCraft: «технические предметы без вкладки творческого режима» — список, который TFC сам ведёт в
 * SelfTests.validateTranslationsAndCreativeTabs (technicalItemsWithNoTab): наполненный лоток (существует только в руке
 * во время промывки, всегда с содержимым), кучки снега и льда, крица и расплав в печи, свет, литое стекло, каменные
 * наковальни. В JEI и творческом их нет. Поля TFCBlocks/TFCItems из списка → имена регистрации по <clinit> их класса.
 */
import { instructions } from '../classfile.mjs';
import { fieldRegistrationNames } from './bytecode.mjs';

export default {
  name: 'TFC (технические предметы без вкладки)',
  mod: 'tfc',
  hidden(set) {
    const jar = set.jarOf('tfc');
    if (!jar) return { entries: [] };
    const names = set.classNames(jar);
    const tests = names.find((n) => /\/SelfTests$/.test(n));
    const cls = tests && set.cls(jar, tests);
    const m = cls?.methods.find((x) => x.name === 'validateTranslationsAndCreativeTabs');
    if (!m?.code)
      return { entries: [], warnings: ['нет SelfTests.validateTranslationsAndCreativeTabs — правило устарело'] };
    const ins = instructions(m.code);
    // Поля до первого Stream.of(…) — это и есть technicalItemsWithNoTab
    const end = ins.findIndex((i) => i.op === 0xb8 && cls.ref(i.index).owner === 'java/util/stream/Stream');
    const fields = [];
    for (const i of ins.slice(0, end < 0 ? 0 : end))
      if (i.op === 0xb2) {
        const r = cls.ref(i.index);
        if (/\/TFC(Blocks|Items)$/.test(r.owner)) fields.push(r);
      }
    if (!fields.length)
      return { entries: [], warnings: ['список technicalItemsWithNoTab не найден — правило устарело'] };
    const entries = [];
    const warnings = [];
    const why = 'TFC: технический предмет без вкладки творческого режима (в JEI нет)';
    for (const f of fields) {
      const got = fieldRegistrationNames(set.cls(jar, f.owner), f.name);
      if (!got || (!got.exact.length && !got.patterns.length)) {
        warnings.push(`${f.owner.split('/').at(-1)}.${f.name}: имя регистрации не найдено`);
        continue;
      }
      for (const e of got.exact) entries.push({ id: `tfc:${e}`, why, onlyIfItem: true });
      for (const p of got.patterns) entries.push({ pattern: p, why });
    }
    return { entries, warnings };
  },
};
