/**
 * Мультиблоки Immersive Engineering и аддонов (Advanced TFC Tech) → public/multiblocks.json + public/multiblocks/*.nbt.
 *
 * Откуда что (проверено по байткоду IE 12.4):
 * - Структура — шаблон data/<ns>/structure/multiblocks/<имя>.nbt (формат ванильной структуры, как схемы Create).
 *   Поздний jar перекрывает ранний, как датапак: TFC-IE Crossover подменяет дуговую печь (огнеупорный кирпич TFC).
 *   Воздух из шаблона игра выкидывает (TemplateMultiblock.getTemplate): пустые клетки могут быть чем угодно.
 * - Куда бить молотом и размер — аргументы конструктора IETemplateMultiblock(loc, master, trigger, size, logic)
 *   в классе мультиблока. Лицевая сторона шаблона — юг (+Z): поворот считается от NORTH.getOpposite() к стороне клика.
 * - Зеркальная сборка — canBeMirrored(), у каменных печей (StoneMultiblock) — нет.
 * - Блок-заменитель: если блок шаблона входит в один из тегов MATCH_TAGS, подойдёт любой блок этого тега
 *   (лямбда в IEMultiblocks.init). Состав тегов сайт берёт из tags.json — с правками KubeJS.
 * - Текст — книга IE: assets/<ns>/manual/<запись>.json со страницей { type: "multiblock", name } и
 *   assets/<ns>/manual/<язык>/<запись>.txt. У самого IE перевода новой книги нет (в игре она английская),
 *   у аддонов бывает ru_ru.
 *
 *   { matchTags: [...], list: [{ id, ns, name: {en, ru}, block, size, trigger, mirror, palette, blocks,
 *     source, replaces?, manual: [{ entry, ns, jar, lang, title, subtitle, text, en? }], recipes: [{ t: тип, n: сколько }],
 *     extraTags?, nbt, extra?, formed? (итоговый вид — scripts/mods/multiblock-models.mjs) }] }
 */
import fs from 'node:fs';
import path from 'node:path';
import { openJar } from './zipfile.mjs';
import { argTypes, clinitValues, instructions, parseClass } from './classfile.mjs';
import { readNbt, T } from '../../src/lib/nbt.ts';
import { assetLookup, formedModel } from './multiblock-models.mjs';

/**
 * Теги, внутри которых IE разрешает замену (IEMultiblocks.init → BlockMatcher.addPredicate). «/» в конце — все теги
 * с этим началом: хранилища и листовой металл по всем металлам IE (EnumMetals).
 */
export const MATCH_TAGS = [
  'c:storage_blocks/',
  'c:sheetmetals/',
  'immersiveengineering:scaffoldings/aluminum',
  'immersiveengineering:scaffoldings/steel',
  'immersiveengineering:treated_wood_slab',
  'immersiveengineering:treated_wood',
  'c:fences/steel',
  'c:fences/aluminum',
];

/**
 * Типы рецептов машины, если не совпадают с id блока (тип = id блока находится сам).
 * Плавильная печь — immersiveengineering:alloy, продвинутая доменная — те же рецепты, что у обычной.
 */
const RECIPE_TYPES = {
  'immersiveengineering:alloy_smelter': ['immersiveengineering:alloy'],
  'immersiveengineering:blast_furnace': [
    'immersiveengineering:blast_furnace',
    'immersiveengineering:blast_furnace_fuel',
  ],
  'immersiveengineering:advanced_blast_furnace': [
    'immersiveengineering:blast_furnace',
    'immersiveengineering:blast_furnace_fuel',
  ],
  'immersiveengineering:diesel_generator': ['immersiveengineering:generator_fuel'],
  'immersiveengineering:excavator': ['immersiveengineering:mineral_mix'],
};

const STRUCT_RE = /^data\/([a-z0-9_.-]+)\/structure\/(multiblocks\/[a-z0-9_/.-]+)\.nbt$/;
const SUPER_DESC =
  '(Lnet/minecraft/resources/ResourceLocation;Lnet/minecraft/core/BlockPos;Lnet/minecraft/core/BlockPos;Lnet/minecraft/core/BlockPos;';

/** Конструктор класса мультиблока: путь шаблона, точка удара, размер, имя регистрации логики */
function readCtor(cls, statics) {
  const init = cls.methods.find((m) => m.name === '<init>' && m.code);
  if (!init) return null;
  let stack = [];
  for (const ins of instructions(init.code)) {
    const { op } = ins;
    if (op >= 0x02 && op <= 0x08) stack.push(op - 0x03);
    else if (op === 0x10 || op === 0x11) stack.push(ins.index);
    else if (op === 0x12 || op === 0x13) stack.push(cls.constant(ins.index));
    else if (op === 0x2a) stack.push({ self: true });
    else if (op === 0xbb) stack.push({ new: cls.className(ins.index), args: null });
    else if (op === 0x59) stack.push(stack.at(-1));
    else if (op === 0xb2) {
      const r = cls.ref(ins.index);
      stack.push({ field: r });
    } else if (op === 0xb8) {
      // IEApi.ieLoc("multiblocks/x") и подобные помощники аддонов → ResourceLocation
      const r = cls.ref(ins.index);
      const args = stack.splice(stack.length - argTypes(r.desc).length);
      stack.push({ loc: args.find((a) => typeof a === 'string') ?? null, owner: r.owner });
    } else if (op === 0xba) {
      const d = cls.nat(cls.cp[ins.index].b);
      stack.splice(stack.length - argTypes(d.desc).length);
      stack.push({ indy: true });
    } else if (op === 0xb7) {
      const r = cls.ref(ins.index);
      const args = stack.splice(stack.length - argTypes(r.desc).length);
      const self = stack.pop();
      if (r.owner === 'net/minecraft/core/BlockPos' && r.name === '<init>') {
        if (self?.new) self.args = args;
      } else if (r.name === '<init>' && r.owner === cls.superName && r.desc.startsWith(SUPER_DESC)) {
        const pos = (v) => {
          if (v?.new && v.args?.every((n) => typeof n === 'number')) return v.args;
          if (v?.field) {
            const s = statics(v.field.owner)?.get(v.field.name);
            if (s?.new && s.args?.every((n) => typeof n === 'number')) return s.args;
          }
          return null;
        };
        return {
          loc: args[0]?.loc ?? null,
          locOwner: args[0]?.owner ?? null,
          trigger: pos(args[2]),
          size: pos(args[3]),
          logic: args[4]?.field?.name ?? null,
        };
      }
    } else stack = [];
  }
  return null;
}

/** canBeMirrored() класса или его предков в том же jar; по умолчанию у TemplateMultiblock — да */
function mirrorable(name, classes) {
  for (let n = name, depth = 0; n && depth < 8; depth++) {
    const cls = classes.get(n);
    if (!cls) return true;
    const m = cls.methods.find((x) => x.name === 'canBeMirrored' && x.desc === '()Z' && x.code);
    if (m) return !(m.code[0] === 0x03 && m.code[1] === 0xac); // iconst_0; ireturn
    n = cls.superName;
  }
  return true;
}

/** Текст страницы книги IE: первая строка — заголовок, вторая — подзаголовок, <br>/<np> — абзацы */
function manualText(raw) {
  const lines = raw.replace(/^﻿/, '').replace(/\r/g, '').split('\n');
  const [title = '', subtitle = '', ...rest] = lines;
  const text = rest
    .join('\n')
    .replace(/<&[a-z0-9_]+>/gi, '')
    .replace(/<link;[^;>]*;([^;>]*)(;[^>]*)?>/g, '$1')
    .replace(/<keybind;([^>]*)>/g, '[$1]')
    .replace(/<config;[a-z]+;([^>]*)>/g, '{config:$1}')
    .replace(/§./g, '')
    .replace(/<(br|np)>/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title: title.trim(), subtitle: subtitle.trim(), text };
}

const asObj = (t) => (t?.type === T.Compound ? t.value : null);
const asList = (t) => (t?.type === T.List ? (t.value.items ?? t.value) : []);
const str = (t) => (t?.type === T.String ? t.value : null);

async function readStructure(buf) {
  const parsed = await readNbt(new Uint8Array(buf));
  const root = parsed.root.value ?? parsed.root;
  const get = (c, k) => c?.get?.(k);
  const size = asList(get(root, 'size')).map((t) => t.value);
  const paletteTags = asList(get(root, 'palette'));
  const palette = paletteTags.map((t) => {
    const c = asObj(t);
    const props = asObj(get(c, 'Properties'));
    const p = props ? Object.fromEntries([...props].map(([k, v]) => [k, str(v)])) : undefined;
    return { id: str(get(c, 'Name')), ...(p && Object.keys(p).length ? { p } : {}) };
  });
  const blocks = [];
  for (const t of asList(get(root, 'blocks'))) {
    const c = asObj(t);
    const pos = asList(get(c, 'pos')).map((v) => v.value);
    const state = get(c, 'state')?.value;
    if (palette[state]?.id === 'minecraft:air') continue;
    blocks.push([pos[0], pos[1], pos[2], state]);
  }
  // Палитра без воздуха, с перенумерацией
  const used = [...new Set(blocks.map((b) => b[3]))].sort((a, b) => a - b);
  const remap = new Map(used.map((s, i) => [s, i]));
  return {
    size,
    palette: used.map((s) => palette[s]),
    blocks: blocks.map(([x, y, z, s]) => [x, y, z, remap.get(s)]),
  };
}

export async function writeMultiblocks(jarPaths, recipes, lang, outFile, outDir, vanillaAssets) {
  const warnings = [];
  /** jar с ассетами мультиблоков (модели собранных машин, их текстуры, переопределения текстур IE аддонами) */
  const assetZips = [];
  /** «ns:multiblocks/x» → { buf, jar, replaces? } — поздний jar перекрывает */
  const structures = new Map();
  const ctors = [];
  /** «ns:multiblocks/x» → [{ entry, ns, jar, texts: { en_us, ru_ru } }] */
  const manual = new Map();

  for (const jarPath of jarPaths) {
    const jar = path.basename(jarPath, '.jar');
    let zip;
    try {
      zip = openJar(jarPath);
    } catch {
      continue;
    }
    const entries = zip.getEntries();
    const own = entries.filter((e) => STRUCT_RE.test(e.entryName));
    if (own.length || entries.some((e) => /^assets\/(immersiveengineering|advancedtfctech)\//.test(e.entryName)))
      assetZips.push(zip);
    const manualJson = entries.filter((e) => /^assets\/[a-z0-9_.-]+\/manual\/[a-z0-9_]+\.json$/.test(e.entryName));
    if (!own.length && !manualJson.length) continue;
    for (const e of own) {
      const [, ns, p] = e.entryName.match(STRUCT_RE);
      const key = `${ns}:${p}`;
      const prev = structures.get(key);
      structures.set(key, { buf: e.getData(), jar, ...(prev ? { replaces: prev.jar } : {}) });
    }
    // Записи книги со страницами-мультиблоками
    const byName = new Map(entries.map((e) => [e.entryName, e]));
    for (const e of manualJson) {
      const [, ns, entry] = e.entryName.match(/^assets\/([^/]+)\/manual\/([^/]+)\.json$/);
      let j;
      try {
        j = JSON.parse(e.getData().toString('utf8'));
      } catch {
        continue;
      }
      const names = Object.values(j ?? {})
        .filter((pg) => pg && typeof pg === 'object' && pg.type === 'multiblock' && typeof pg.name === 'string')
        .map((pg) => (pg.name.includes(':') ? pg.name : `immersiveengineering:${pg.name}`));
      if (!names.length) continue;
      const texts = {};
      for (const l of ['en_us', 'ru_ru']) {
        const t = byName.get(`assets/${ns}/manual/${l}/${entry}.txt`);
        if (t) texts[l] = manualText(t.getData().toString('utf8'));
      }
      for (const n of names) {
        const list = manual.get(n) ?? [];
        list.push({ entry, ns, jar, texts });
        manual.set(n, list);
      }
    }
    if (!own.length) continue;
    // Классы мультиблоков: наследники IETemplateMultiblock (и их предки — для canBeMirrored)
    const classes = new Map();
    for (const e of entries) {
      if (!e.entryName.endsWith('.class')) continue;
      const data = e.getData();
      if (!data.includes('TemplateMultiblock') && !data.includes('multiblocks/')) continue;
      try {
        const cls = parseClass(data);
        classes.set(cls.name, cls);
      } catch {
        /* не класс */
      }
    }
    const staticsCache = new Map();
    const statics = (owner) => {
      if (!staticsCache.has(owner)) {
        const c = classes.get(owner);
        staticsCache.set(owner, c ? clinitValues(c).statics : null);
      }
      return staticsCache.get(owner);
    };
    for (const cls of classes.values()) {
      const c = readCtor(cls, statics);
      if (!c?.loc?.startsWith('multiblocks/')) continue;
      // Бункер и резервуар: железный листовой металл заменяется любым (своя лямбда-проверка на c:sheetmetals)
      const anySheetmetal = cls.cp.some((k, i) => k?.tag === 9 && cls.ref(i)?.name === 'sheetmetals');
      ctors.push({
        ...c,
        jar,
        cls: cls.name,
        mirror: mirrorable(cls.name, classes),
        ownNs: own.map((e) => e.entryName.split('/')[1]),
        ...(anySheetmetal ? { extraTags: ['c:sheetmetals'] } : {}),
      });
    }
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  const getAsset = assetLookup(assetZips, vanillaAssets);
  const list = [];
  const claimed = new Set();
  /** тип рецепта → сколько рецептов в модах (удаления KubeJS не учтены) */
  const recipeTypes = new Map();
  for (const r of recipes.values())
    if (typeof r.json?.type === 'string') recipeTypes.set(r.json.type, (recipeTypes.get(r.json.type) ?? 0) + 1);
  for (const c of ctors) {
    // Namespace шаблона: IEApi.ieLoc → immersiveengineering, у аддона — его собственный
    const nsCandidates = /IEApi$/.test(c.locOwner ?? '')
      ? ['immersiveengineering']
      : [...c.ownNs, 'immersiveengineering'];
    const ns = nsCandidates.find((n) => structures.has(`${n}:${c.loc}`));
    if (!ns) {
      warnings.push(`нет шаблона ${c.loc} для ${c.cls}`);
      continue;
    }
    const key = `${ns}:${c.loc}`;
    if (claimed.has(key)) continue;
    claimed.add(key);
    const s = structures.get(key);
    const st = await readStructure(s.buf);
    const name = c.loc.slice('multiblocks/'.length);
    // Блок машины — по имени регистрации логики (IEMultiblockLogic.CRUSHER → crusher), проверяем по переводу
    const blockNs = ns;
    // ADV_BLAST_FURNACE → advanced_blast_furnace
    const logic = c.logic?.toLowerCase();
    const candidates = [logic, logic?.replace(/^adv_/, 'advanced_'), name].filter(Boolean);
    const blockPath = candidates.find((p) => lang(`block.${blockNs}.${p}`).en) ?? null;
    const n = blockPath ? lang(`block.${blockNs}.${blockPath}`) : { en: null, ru: null };
    const entries = (manual.get(key) ?? []).map((m) => {
      const t = m.texts.ru_ru ?? m.texts.en_us;
      return t
        ? {
            entry: m.entry,
            ns: m.ns,
            jar: m.jar,
            lang: m.texts.ru_ru ? 'ru' : 'en',
            ...t,
            ...(m.texts.ru_ru && m.texts.en_us ? { en: m.texts.en_us.text } : {}),
          }
        : null;
    });
    const nbtRel = `${ns}/${name}.nbt`;
    fs.mkdirSync(path.join(outDir, ns), { recursive: true });
    fs.writeFileSync(path.join(outDir, nbtRel), s.buf);
    if (st.size.join('x') !== (c.size ?? []).join('x'))
      warnings.push(`${key}: размер шаблона ${st.size} ≠ код ${c.size}`);
    const blockId = blockPath ? `${blockNs}:${blockPath}` : null;
    const title = entries.find((e) => e?.ns === ns)?.title;
    list.push({
      id: `${ns}:${name}`,
      ns,
      name: { en: n.en ?? title ?? name, ru: n.ru ?? null },
      block: blockId,
      size: st.size,
      trigger: c.trigger,
      mirror: c.mirror,
      ...(c.extraTags ? { extraTags: c.extraTags } : {}),
      palette: st.palette,
      blocks: st.blocks,
      source: s.jar,
      ...(s.replaces ? { replaces: s.replaces } : {}),
      manual: entries.filter(Boolean),
      recipes: (RECIPE_TYPES[blockId] ?? [blockId])
        .filter((t) => recipeTypes.has(t))
        .map((t) => ({ t, n: recipeTypes.get(t) })),
      nbt: nbtRel,
    });
    const formed = blockId ? formedModel(getAsset, blockId, st, outDir, name, warnings) : null;
    if (formed) list.at(-1).formed = formed;
  }
  // Шаблоны без своего класса (excavator_full — экскаватор целиком для книги) — вид у мультиблока с тем же началом имени
  for (const [key, s] of structures) {
    if (claimed.has(key)) continue;
    const [ns, p] = key.split(':');
    const name = p.slice('multiblocks/'.length);
    const host = list.find((m) => m.ns === ns && name.startsWith(`${m.id.split(':')[1]}_`));
    if (!host) continue;
    const st = await readStructure(s.buf);
    const nbtRel = `${ns}/${name}.nbt`;
    fs.mkdirSync(path.join(outDir, ns), { recursive: true });
    fs.writeFileSync(path.join(outDir, nbtRel), s.buf);
    host.extra = { id: key, size: st.size, palette: st.palette, blocks: st.blocks, nbt: nbtRel };
  }
  // Записи книги об изменениях из других модов (TFC-IE Crossover про дуговую печь) остаются у мультиблока как есть
  list.sort(
    (a, b) =>
      (a.ns === b.ns ? 0 : a.ns === 'immersiveengineering' ? -1 : 1) ||
      (a.name.ru ?? a.name.en).localeCompare(b.name.ru ?? b.name.en, 'ru'),
  );
  fs.writeFileSync(outFile, JSON.stringify({ matchTags: MATCH_TAGS, list }));
  return { count: list.length, kb: Math.round(fs.statSync(outFile).size / 1024), warnings };
}
