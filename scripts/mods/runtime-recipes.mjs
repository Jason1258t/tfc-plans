/**
 * Рецепты, которые Create добавляет при запуске, а не хранит в data/.../recipe.
 * Связи цемент → бетон читаем из конструкторов ConcretePowderBlock в Minecraft, без списка цветов.
 * Алгоритм и id проверены в RuntimeDataGenerator Create 6.0.10; неизвестную реализацию пропускаем.
 */
import path from 'node:path';
import AdmZip from 'adm-zip';
import { clinitValues, instructions, parseClass } from './classfile.mjs';

export function concretePairs(blocksBuffer, powderClass) {
  const cls = parseClass(blocksBuffer);
  const { statics } = clinitValues(cls);
  const pairs = [];
  for (const value of statics.values()) {
    const [name, block] = value?.args ?? [];
    if (typeof name !== 'string' || block?.new !== powderClass) continue;
    const target = block.args?.[0]?.field;
    if (target?.owner !== cls.name) continue;
    const output = statics.get(target.name)?.args?.[0];
    if (typeof output === 'string') pairs.push([`minecraft:${name}`, `minecraft:${output}`]);
  }
  return pairs;
}

/** Официальные mappings нужны только для имён двух классов; поля разрешаются внутри того же class-файла. */
export function vanillaConcretePairs(zip, mappings) {
  const mapped = (name) => {
    const prefix = `${name} -> `;
    const line = mappings.split('\n').find((line) => line.startsWith(prefix));
    if (!line) throw new Error(`нет класса ${name} в mappings Minecraft`);
    return line.slice(prefix.length, -1).replaceAll('.', '/');
  };
  const blocks = mapped('net.minecraft.world.level.block.Blocks');
  const powder = mapped('net.minecraft.world.level.block.ConcretePowderBlock');
  const entry = zip.getEntry(`${blocks}.class`);
  if (!entry) throw new Error(`нет класса ${blocks} в client.jar`);
  const pairs = concretePairs(entry.getData(), powder);
  if (!pairs.length) throw new Error('не удалось прочитать связи цемента и бетона из Minecraft');
  return pairs;
}

/** Добавляет слой до JSON-рецептов модов: явный файл с тем же id имеет приоритет. */
export function createWashingRecipes(jars, pairs, itemIds, warn = console.warn) {
  const recipes = new Map();
  const known = new Set(itemIds);
  const owner = 'com/simibubi/create/foundation/data/RuntimeDataGenerator';
  for (const file of jars) {
    let zip;
    try {
      zip = new AdmZip(file);
    } catch {
      continue; // Нечитаемые jar уже отмечены основным сборщиком.
    }
    const entry = zip.getEntry(`${owner}.class`);
    if (!entry) continue;
    const cls = parseClass(entry.getData());
    const washing = cls.methods.find((m) => m.name === 'washingRecipes');
    const calls = washing?.code
      ? instructions(washing.code)
          .filter((i) => i.op >= 0xb6 && i.op <= 0xb9)
          .map((i) => cls.ref(i.index))
      : [];
    if (!calls.some((r) => r.name === 'create$getConcrete') || !calls.some((r) => r.name === 'simpleSplashingRecipe')) {
      warn('Изменился генератор промывки Create — проверьте RuntimeDataGenerator');
      continue;
    }
    const builderEntry = zip.getEntry(`${owner}$StandardBuilder.class`);
    const builder = builderEntry && parseClass(builderEntry.getData());
    const template = builder?.cp.some((c) => c?.v === 'runtime_generated/compat/\u0001/\u0001_to_\u0001');
    if (!template) {
      warn('Изменился формат id рецептов Create — проверьте StandardBuilder');
      continue;
    }
    for (const [input, output] of pairs) {
      if (!known.has(input) || !known.has(output)) continue;
      const [ns, from] = input.split(':');
      const to = output.split(':')[1];
      recipes.set(`create:splashing/runtime_generated/compat/${ns}/${from}_to_${to}`, {
        source: path.basename(file, '.jar'),
        json: { type: 'create:splashing', ingredients: [{ item: input }], results: [{ id: output }] },
        runtime: true,
      });
    }
  }
  return recipes;
}
