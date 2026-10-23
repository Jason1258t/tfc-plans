/**
 * Инструменты MCP: ресурсы клиента без запуска игры — рисунок модели (model_render), текстура с палитрой
 * (texture_get), проверка ресурсов мода или аддона (resources_check: то, что клиент проверяет при загрузке).
 * Слои ресурсов и parent — ../resources.mjs, растеризатор — ../render.mjs, свойства блоков — байткод
 * (scripts/mods/classfile.mjs) с цепочкой предков из jar сборки и Minecraft.
 */
import fs from 'node:fs';
import path from 'node:path';
import { clinitValues, enumConstants, instructions, parseClass } from '../../mods/classfile.mjs';
import { codeRefs, parseClassFull } from '../bytecode.mjs';
import { classRecord, parseToml } from '../code-index.mjs';
import { mods, tags } from '../data.mjs';
import { num, str } from '../fmt.mjs';
import { jarToc, readEntry, resolveJar } from '../jars.mjs';
import { loadTexture, renderId, textureImage } from '../render.mjs';
import {
  addonDirs,
  addonRoot,
  blockstatePath,
  findResource,
  loadModel,
  modelPath,
  parseState,
  readJsonRes,
  resLoc,
  resolveTexture,
  resourceLayers,
  stateText,
  statePropsOf,
  texturePath,
} from '../resources.mjs';

// ---------------------------------------------------------------- model_render

/** Слои ресурсов; addon — папка аддона (в т. ч. в git worktree) поверх одноимённой из tools/ */
function layersFor(a) {
  const q = String(a.addon ?? '').trim();
  if (!q) return resourceLayers();
  const addon = addonRoot(q);
  if (!addon) throw new Error(`${q}: нет ни src/main/resources, ни папки с assets/`);
  return resourceLayers(null, true, null, addon);
}

function modelRender(a) {
  const r = renderId(layersFor(a), String(a.id ?? '').trim(), {
    kind: a.kind,
    state: a.state,
    view: a.view,
    size: Math.min(1024, Math.max(32, Number(a.size ?? 256) | 0)),
    texture: a.texture,
    bones: a.bones,
    silhouette: a.silhouette,
  });
  return r.png ? { text: r.lines.join('\n'), images: [r.png] } : r.lines.join('\n');
}

// ---------------------------------------------------------------- texture_get

function textureGet(a) {
  const layers = layersFor(a);
  let id = String(a.path ?? '').trim();
  const m = id.match(/^assets\/([^/]+)\/textures\/(.+?)(\.png)?$/);
  if (m) id = `${m[1]}:${m[2]}`;
  const t = loadTexture(layers, id);
  if (!t) return `Текстуры ${texturePath(id)} нет ни в одном слое.`;
  if (t.error) return `${texturePath(id)} (${t.from}): ${t.error}`;
  const counts = new Map();
  let opaque = 0;
  let semi = 0;
  for (let i = 0; i < t.rgb.length; i++) {
    if (!t.a[i]) continue;
    opaque++;
    if (t.a[i] < 255) semi++;
    counts.set(t.rgb[i], (counts.get(t.rgb[i]) ?? 0) + 1);
  }
  const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
  const top = [...counts].sort((x, y) => y[1] - x[1]).slice(0, Math.min(32, Number(a.colors ?? 12) | 0 || 12));
  const lines = [
    `${texturePath(id)} — ${t.from}`,
    `размер ${t.w}×${t.fullH}${t.frames > 1 ? `, анимация: ${t.frames} кадров ${t.w}×${t.h}` : ''}; непрозрачных пикселей ${opaque} из ${t.rgb.length}${semi ? `, полупрозрачных ${semi}` : ''}; цветов ${counts.size}`,
    `палитра (частые цвета, доля непрозрачных): ${top.map(([c, n]) => `${hex(c)} ${((n / opaque) * 100).toFixed(1)}%`).join(', ')}`,
  ];
  return { text: lines.join('\n'), images: [textureImage(t, Math.min(1024, Math.max(16, Number(a.size ?? 256) | 0)))] };
}

// ---------------------------------------------------------------- классы цели проверки

/** Классы аддона (build/classes) или jar: { names, read(name) → Buffer } */
function classSource(target) {
  if (target.classesDir) {
    const names = [];
    const walk = (rel) => {
      for (const d of fs.readdirSync(path.join(target.classesDir, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${d.name}` : d.name;
        if (d.isDirectory()) walk(r);
        else if (r.endsWith('.class')) names.push(r.slice(0, -6));
      }
    };
    if (fs.existsSync(target.classesDir)) walk('');
    return { names, read: (n) => fs.readFileSync(path.join(target.classesDir, `${n}.class`)) };
  }
  if (target.jar) {
    const names = jarToc(target.jar)
      .filter((e) => e.name.endsWith('.class') && !e.name.startsWith('META-INF/'))
      .map((e) => e.name.slice(0, -6));
    return { names, read: (n) => readEntry(target.jar, `${n}.class`)?.data };
  }
  return { names: [], read: () => null };
}

/** Загрузчик классов: сначала цель, потом индекс jar сборки и Minecraft */
function classLoader(src) {
  const own = new Set(src.names);
  const cache = new Map();
  const load = (name, full = false) => {
    const key = `${full ? 'F' : 'S'}${name}`;
    if (cache.has(key)) return cache.get(key);
    let buf = null;
    if (own.has(name)) buf = src.read(name);
    else {
      const rec = classRecord(name);
      if (rec) buf = readEntry(rec.jar, rec.path)?.data ?? null;
    }
    let c = null;
    try {
      c = buf ? (full ? parseClassFull(buf) : parseClass(buf)) : null;
    } catch {
      c = null;
    }
    cache.set(key, c);
    return c;
  };
  return load;
}

const BLOCK = 'net/minecraft/world/level/block/Block';
const ITEM = 'net/minecraft/world/item/Item';
const BUILDER_DESC = '(Lnet/minecraft/world/level/block/state/StateDefinition$Builder;)V';

/** Вид класса: block | item | null — по цепочке предков */
function kindOf(load, name) {
  const seen = new Set();
  for (let cur = name; cur && !seen.has(cur);) {
    seen.add(cur);
    if (cur === BLOCK) return 'block';
    if (cur === ITEM) return 'item';
    cur = load(cur)?.superName;
  }
  return null;
}

// ---------------------------------------------------------------- свойства блока из байткода

const DIRS = ['north', 'east', 'south', 'west', 'up', 'down'];

/** Значения свойства: { name, values: [строки] | null, note? } по статическому полю owner.field */
function propertyInfo(load, owner, field, depth = 0) {
  if (depth > 6) return null;
  // getstatic Foo.X может ссылаться на поле предка (наследуется) — ищем объявление вверх по цепочке
  for (let c = owner, n = 0; c && n < 12; n++) {
    const cls = load(c);
    if (!cls) return null;
    if (cls.fields.some((f) => f.name === field))
      return propertyFromValue(load, clinitValues(cls).statics.get(field), depth);
    c = cls.superName;
  }
  return null;
}

function propertyFromValue(load, v, depth) {
  if (!v || typeof v !== 'object') return null;
  if (v.field) return propertyInfo(load, v.field.owner, v.field.name, depth + 1);
  if (!v.call || typeof v.args?.[0] !== 'string') return null;
  const owner = v.call.owner;
  const name = v.args[0];
  const simple = owner.slice(owner.lastIndexOf('/') + 1);
  if (/BooleanProperty$/.test(simple)) return { name, values: ['true', 'false'] };
  if (/IntegerProperty$/.test(simple) && typeof v.args[1] === 'number' && typeof v.args[2] === 'number') {
    const out = [];
    for (let i = v.args[1]; i <= v.args[2]; i++) out.push(String(i));
    return { name, values: out };
  }
  if (/DirectionProperty$/.test(simple)) {
    const arg = v.args[1];
    if (v.args.length === 1) return { name, values: DIRS };
    if (arg?.call?.name === 'values') return { name, values: DIRS };
    if (arg?.field?.name === 'HORIZONTAL') return { name, values: ['north', 'east', 'south', 'west'] };
    if (arg?.field?.name === 'VERTICAL') return { name, values: ['up', 'down'] };
    if (arg?.array?.every((x) => x?.field)) return { name, values: arg.array.map((x) => x.field.name.toLowerCase()) };
    return { name, values: null, note: 'набор направлений задан кодом (фильтр) — не разобран' };
  }
  if (/EnumProperty$/.test(simple) && v.args[1]?.class) {
    const all = enumValues(load, v.args[1].class);
    if (v.args.length > 2) {
      const arr = v.args[2]?.array;
      if (arr?.every((x) => x?.field)) return { name, values: arr.map((x) => x.field.name.toLowerCase()) };
      return { name, values: all, note: 'у перечисления фильтр значений — взяты все' };
    }
    return { name, values: all };
  }
  return { name, values: null, note: `свойство ${simple} — значения не разобраны` };
}

/** Значения перечисления для блокстейта (getSerializedName): строковый аргумент конструктора или имя в нижнем регистре */
function enumValues(load, cls) {
  const c = load(cls);
  if (!c) return null;
  const consts = enumConstants(c);
  // Константы с телом (Direction.Axis: new Axis$1(…)) стековая машина не видит — тогда по полям ACC_ENUM
  if (!consts.length) {
    const fields = c.fields.filter((f) => f.access & 0x4000 && f.desc === `L${cls};`);
    return fields.length ? fields.map((f) => f.name.toLowerCase()) : null;
  }
  const ser = c.methods.find((m) => m.name === 'getSerializedName' && m.desc === '()Ljava/lang/String;');
  const readsField = ser?.code && instructions(ser.code).some((i) => i.op === 0xb4);
  return consts.map((k) => {
    const s = readsField ? k.args.find((x) => typeof x === 'string') : null;
    return s ?? k.name.toLowerCase();
  });
}

/** Свойства блока: createBlockStateDefinition класса и предков → [{ name, values, note?, from }] */
function blockProperties(load, name) {
  const out = [];
  const notes = [];
  const seen = new Set();
  const visit = (cur) => {
    for (let c = cur; c && c !== BLOCK && !seen.has(c);) {
      seen.add(c);
      const cls = load(c);
      if (!cls) {
        notes.push(`класс ${c} не найден — свойства предков могли потеряться`);
        return;
      }
      const m = cls.methods.find((x) => x.name === 'createBlockStateDefinition' && x.desc === BUILDER_DESC);
      if (!m?.code) {
        c = cls.superName;
        continue;
      }
      let found = 0;
      let opaque = false;
      for (const ins of instructions(m.code)) {
        if (ins.op === 0xb2) {
          const r = cls.ref(ins.index);
          if (!/Property;$/.test(r.desc)) continue;
          const info = propertyInfo(load, r.owner, r.name);
          found++;
          if (!info) {
            notes.push(`${r.owner.split('/').pop()}.${r.name}: свойство не разобрано`);
            out.incomplete = true;
            continue;
          }
          if (!out.some((p) => p.name === info.name))
            out.push({ ...info, from: `${r.owner.split('/').pop()}.${r.name}` });
        } else if (ins.op === 0xb7) {
          const r = cls.ref(ins.index);
          if (r.name === 'createBlockStateDefinition') visit(r.owner);
        } else if (ins.op === 0xb4 || ins.op === 0xb6 || ins.op === 0xb8 || ins.op === 0xb9) {
          // Свойство из поля экземпляра или метода (getFluidProperty()) — значение не из статики
          const r = cls.ref(ins.index);
          if (/Property;$/.test(r.desc)) {
            notes.push(
              `${c.split('/').pop()}.createBlockStateDefinition: свойство из ${r.name}${ins.op === 0xb4 ? '' : '()'} — не разобрано`,
            );
            out.incomplete = true;
          }
          opaque = true;
        }
      }
      if (!found && opaque && !out.incomplete) {
        notes.push(`${c.split('/').pop()}.createBlockStateDefinition: свойства не из статических полей — не разобраны`);
        out.incomplete = true;
      }
      return;
    }
  };
  visit(name);
  return { props: out, notes };
}

// ---------------------------------------------------------------- регистрации из байткода

const REGISTER = /^register(Block|Item|SimpleBlock|SimpleItem|SimpleBlockItem)?$/;
/** Registrate (Create и аддоны): REGISTRATE.block("id", Foo::new) / .item("id", Foo::new) */
const REGISTRATE = /^(block|item)$/;

/**
 * Что мод регистрирует: [{ id | null, cls | null, kind: block|item|null, where }]. Шаблон javac:
 * ldc "id" … invokedynamic (лямбда / ссылка на конструктор) … invokevirtual register*(String, …).
 * id из переменной (цикл) — null: класс известен, имя нет.
 */
function registrations(src, load) {
  const out = [];
  for (const n of src.names) {
    const cls = load(n);
    if (!cls) continue;
    for (const m of cls.methods) {
      if (!m.code) continue;
      let lastStr = null;
      let lastStrAt = -99;
      let lastNew = null;
      const ins = instructions(m.code);
      ins.forEach((i, k) => {
        if (i.op === 0x12 || i.op === 0x13) {
          const v = cls.constant(i.index);
          if (typeof v === 'string') {
            lastStr = v;
            lastStrAt = k;
          }
        } else if (i.op === 0xba) {
          const impl = cls.bootstrap[cls.cp[i.index].a]?.find((x) => x?.handle)?.handle;
          if (!impl) return;
          if (impl.name === '<init>') lastNew = impl.owner;
          else if (impl.owner === cls.name) {
            const body = cls.methods.find((x) => x.name === impl.name && x.desc === impl.desc);
            const nw = body?.code && instructions(body.code).find((x) => x.op === 0xbb);
            lastNew = nw ? cls.className(nw.index) : null;
          } else lastNew = null;
        } else if (i.op === 0xb6 || i.op === 0xb9 || i.op === 0xb8) {
          const r = cls.ref(i.index);
          if (!r.desc.startsWith('(Ljava/lang/String;')) return;
          const viaRegistrate = /Registrate/.test(r.owner) && REGISTRATE.test(r.name);
          // Свой помощник мода (TFCBlocks.register("id", () -> new Foo…)) — если лямбда создаёт блок или предмет
          const standard = viaRegistrate || (REGISTER.test(r.name) && /DeferredRegister|Registr/.test(r.owner));
          const helper = !standard && /^register/.test(r.name) && lastNew && kindOf(load, lastNew);
          if (!standard && !helper) return;
          const id = k - lastStrAt <= 8 ? lastStr : null;
          let c = lastNew;
          let kind = c ? kindOf(load, c) : null;
          if (/SimpleBlock$|Block$/.test(r.name) && !c) kind = 'block';
          if (/SimpleItem$|SimpleBlockItem$/.test(r.name)) [c, kind] = [c ?? ITEM, 'item'];
          if (/Blocks$/.test(r.owner) && !kind) kind = 'block';
          if (/Items$/.test(r.owner) && !kind) kind = 'item';
          if (viaRegistrate && !kind) kind = r.name;
          if (kind) out.push({ id, cls: c, kind, where: `${n.split('/').pop()}.${m.name}`, weak: Boolean(helper) });
          lastNew = null;
          lastStr = null;
        }
      });
    }
  }
  return out;
}

/** Вызов, первый аргумент которого — ключ перевода: Component.translatable*, I18n.get/exists, new TranslatableContents */
const isTranslateCall = (r) =>
  r.kind === 'method' &&
  r.desc.startsWith('(Ljava/lang/String;') &&
  ((/\/(Component|MutableComponent)$/.test(r.owner) && r.name.startsWith('translatable')) ||
    (r.owner.endsWith('/I18n') && (r.name === 'get' || r.name === 'exists')) ||
    (r.owner.endsWith('/TranslatableContents') && r.name === '<init>'));

/**
 * Индексы строк — ключей перевода перед вызовом k: ldc сразу перед вызовом, а у тернарного оператора — две и
 * больше ldc подряд (ветки сходятся на одном вызове). У translatable(key, Object...) строки после
 * anewarray Object — аргументы, ключ — до него.
 */
function translateKeys(refs, k) {
  let j = k - 1;
  if (refs[k].desc.includes('[Ljava/lang/Object;')) {
    const stop = Math.max(0, k - 40);
    while (j >= stop && !(refs[j].kind === 'class' && refs[j].owner === 'java/lang/Object')) j--;
    if (j < stop) return [];
    j--;
  }
  const out = [];
  for (; j >= 0 && refs[j].kind === 'string' && refs[j].op !== 'concat'; j--) out.push(j);
  return out;
}

/** Строки кода: ключи перевода и PartialModel.of(...) — по codeRefs (вкл. шаблоны склейки строк) */
function codeStrings(src, load) {
  const strings = [];
  const partials = [];
  for (const n of src.names) {
    const cls = load(n, true);
    if (!cls) continue;
    for (const m of cls.methods) {
      const refs = codeRefs(cls, m);
      const keys = new Set(refs.flatMap((r, k) => (isTranslateCall(r) ? translateKeys(refs, k) : [])));
      refs.forEach((r, k) => {
        if (r.kind === 'string')
          strings.push({
            value: r.value,
            concat: r.op === 'concat',
            key: keys.has(k),
            where: `${n.split('/').pop()}.${m.name}`,
          });
        if (r.kind === 'method' && r.name === 'of' && r.owner.endsWith('/PartialModel')) {
          const prev = refs.slice(Math.max(0, k - 5), k).filter((x) => x.kind === 'string' && x.op !== 'concat');
          partials.push({ strs: prev.map((x) => x.value), where: `${n.split('/').pop()}.${m.name}` });
        }
      });
    }
  }
  return { strings, partials };
}

// ---------------------------------------------------------------- resources_check

/** Цель: папка аддона (имя в tools/ или путь) или мод сборки */
function checkTarget(a) {
  const q = String(a.addon ?? a.path ?? '').trim();
  if (q) {
    const { dir, res } = addonRoot(q) ?? {};
    if (!res)
      throw new Error(
        `${q}: нет ни tools/<аддон>/src/main/resources, ни папки с assets/ (аддоны: ${addonDirs()
          .map((d) => d.name)
          .join(', ')})`,
      );
    const classesDir = path.join(dir, 'build/classes/java/main');
    const toml = path.join(res, 'META-INF/neoforge.mods.toml');
    // Только [[mods]]: modId в [[dependencies.…]] — чужие моды
    const ids = fs.existsSync(toml)
      ? (parseToml(fs.readFileSync(toml, 'utf8')).mods ?? []).map((m) => m.modId).filter(Boolean)
      : [];
    return {
      label: `аддон ${path.relative(process.cwd(), dir) || dir}`,
      only: { addon: res },
      classesDir: fs.existsSync(classesDir) ? classesDir : null,
      ids,
      classesNote: fs.existsSync(classesDir) ? null : 'нет build/classes — классы не проверялись (соберите аддон)',
    };
  }
  const mod = String(a.mod ?? '').trim();
  if (!mod) throw new Error('укажите mod (id или jar сборки) или addon (папка tools/<аддон>)');
  const jar = resolveJar(mod);
  const ids = [...mods().values()].filter((m) => m.jar === jar).map((m) => m.id);
  return { label: `jar ${jar}`, only: { jar }, jar, ids: ids.length ? ids : [mod] };
}

function resourcesCheck(a) {
  const target = checkTarget(a);
  const own = resourceLayers(target.only, false)[0];
  const errors = [];
  const warns = [];
  const info = [];
  if (target.classesNote) warns.push(target.classesNote);

  // namespace мода: из mods.toml/манифеста, а если ресурсов под ним нет — все из assets/, кроме minecraft
  const assetNs = new Set(own.list('assets/').map((p) => p.split('/')[1]));
  let spaces = target.ids.filter((x) => assetNs.has(x));
  if (!spaces.length) spaces = [...assetNs].filter((x) => x !== 'minecraft');
  const main = spaces[0] ?? target.ids[0];
  // Аддон: его же jar в сборке (старая версия) не должен подставлять файлы, пропавшие в папке
  const skip = target.only.addon
    ? new Set([...mods().values()].filter((m) => target.ids.includes(m.id)).map((m) => m.jar))
    : null;
  const layers = resourceLayers(target.only, true, skip);

  // Классы: регистрации, свойства блоков, строки
  const src = classSource(target);
  const load = classLoader(src);
  const regs = src.names.length ? registrations(src, load) : [];
  const code = src.names.length ? codeStrings(src, load) : { strings: [], partials: [] };

  const blocks = new Map(); // id → { cls, sources: Set }
  const items = new Map();
  const note = (map, id, cls, why) => {
    const e = map.get(id) ?? map.set(id, { cls: null, why: new Set() }).get(id);
    if (cls && !e.cls) e.cls = cls;
    e.why.add(why);
  };
  // Через свой помощник мода строка может быть частью имени — такие id берём, только если блок виден по ресурсам
  for (const r of regs)
    if (r.id && !r.weak) note(r.kind === 'block' ? blocks : items, `${main}:${r.id}`, r.cls, 'регистрация в коде');
  for (const ns of spaces) {
    for (const p of own.list(`assets/${ns}/blockstates/`))
      if (p.endsWith('.json'))
        note(blocks, `${ns}:${p.slice(`assets/${ns}/blockstates/`.length, -5)}`, null, 'блокстейт');
    for (const p of own.list(`data/${ns}/loot_table/blocks/`))
      if (p.endsWith('.json'))
        note(blocks, `${ns}:${p.slice(`data/${ns}/loot_table/blocks/`.length, -5)}`, null, 'добыча');
  }
  for (const r of regs) {
    const map = r.kind === 'block' ? blocks : items;
    if (r.id && r.weak && map.has(`${main}:${r.id}`)) note(map, `${main}:${r.id}`, r.cls, 'регистрация в коде');
  }
  // Блоки и предметы, зарегистрированные в цикле (id из переменной): класс один на всех — приписываем его
  const loose = (kind, map) => {
    const classes = [
      ...new Set(
        regs
          .filter((r) => (!r.id || r.weak) && r.kind === kind)
          .map((r) => r.cls)
          .filter(Boolean),
      ),
    ];
    const known = new Set(
      regs.filter((r) => r.id && r.kind === kind && map.has(`${main}:${r.id}`)).map((r) => `${main}:${r.id}`),
    );
    const rest = [...map.keys()].filter((id) => !known.has(id) && !map.get(id).cls);
    if (classes.length === 1 && rest.length) {
      for (const id of rest) map.get(id).cls = classes[0];
      info.push(
        `${kind === 'block' ? 'блоки' : 'предметы'} ${rest.join(', ')}: id из переменной (цикл) — класс ${classes[0].split('/').pop()} приписан по единственному кандидату`,
      );
    } else if (classes.length > 1 && rest.length)
      warns.push(
        `${rest.length} ${kind === 'block' ? 'блоков' : 'предметов'} зарегистрированы в цикле или помощником, классов-кандидатов ${classes.length} (${classes
          .slice(0, 6)
          .map((c) => c.split('/').pop())
          .join(
            ', ',
          )}${classes.length > 6 ? ' …' : ''}) — свойства не сверялись: ${rest.slice(0, 6).join(', ')}${rest.length > 6 ? ' …' : ''}`,
      );
  };
  loose('block', blocks);
  loose('item', items);
  if (regs.some((r) => !r.id && r.kind === 'item'))
    for (const id of blocks.keys())
      if (!items.has(id) && findResource([own], modelPath(`${resLoc(id).ns}:item/${resLoc(id).path}`)))
        note(items, id, null, 'модель предмета блока');

  // Переводы
  const lang = {};
  for (const l of ['en_us', 'ru_ru']) {
    lang[l] = {};
    for (const ns of spaces) {
      const r = readJsonRes([own], `assets/${ns}/lang/${l}.json`);
      if (!r) {
        (l === 'en_us' ? errors : warns).push(`нет assets/${ns}/lang/${l}.json`);
        continue;
      }
      if (!r.json) errors.push(`assets/${ns}/lang/${l}.json: JSON не разобрался — ${r.error}`);
      else Object.assign(lang[l], r.json);
    }
  }
  // Аддон сборки — свой, русский перевод обязателен (игроки видят ru_ru); у чужого мода нет ru_ru — не ошибка
  const keysChecked = new Set();
  const needKey = (key, why) => {
    keysChecked.add(key);
    if (!(key in lang.en_us)) errors.push(`нет перевода ${key} в en_us (${why}) — в игре будет виден сам ключ`);
    if (!(key in lang.ru_ru))
      (target.only.addon ? errors : warns).push(
        `нет перевода ${key} в ru_ru (${why})${target.only.addon ? ' — у игроков будет английский текст' : ''}`,
      );
  };

  // Модели: проверка цепочки и текстур (с кешем по id)
  const checkedModels = new Map();
  // Чужой namespace, которого нет в сборке (совместимость с необязательным модом) — не ошибка
  const absentNs = (id) => {
    const ns = resLoc(id).ns;
    return ns !== 'minecraft' && !spaces.includes(ns) && !mods().has(ns);
  };
  /**
   * strict — модель используется (блокстейт, предмет, PartialModel): ошибки — ошибки. Файл, на который никто не
   * ссылается, — шаблон для потомков или остаток: незаданные переменные не проверяем, прочее — «к сведению».
   */
  const checkModel = (mid, why, strict = true, particle = false) => {
    const key = `${resLoc(mid).ns}:${resLoc(mid).path}`;
    if (checkedModels.has(key)) return checkedModels.get(key);
    const m = loadModel(layers, key);
    checkedModels.set(key, m);
    const err = (t) => (strict ? errors : info).push(strict ? t : `${t} (на модель никто не ссылается напрямую)`);
    if (!m.chain.length) {
      if (absentNs(key)) warns.push(`модель ${modelPath(key)} — мода ${resLoc(key).ns} нет в сборке (${why})`);
      else errors.push(`нет модели ${modelPath(key)} (${why})`);
      return m;
    }
    for (const x of m.missing)
      if (absentNs(x)) warns.push(`модель ${key}: parent ${x} — мода ${resLoc(x).ns} нет в сборке`);
      else err(`модель ${key}: нет parent ${modelPath(x)}`);
    for (const e of m.errors) err(`модель ${key}: ${e}`);
    const refs = new Set();
    for (const el of m.elements ?? []) {
      for (const c of [...(el.from ?? []), ...(el.to ?? [])])
        if (c < -16 || c > 32) err(`модель ${key}: координата элемента ${c} вне −16…32 — модель не загрузится`);
      const ang = el.rotation?.angle;
      if (ang != null && ![-45, -22.5, 0, 22.5, 45].includes(ang))
        err(`модель ${key}: rotation.angle ${ang} — допустимы только −45, −22.5, 0, 22.5, 45`);
      for (const f of Object.values(el.faces ?? {})) refs.add(f.texture);
    }
    if (m.generated) for (const k of Object.keys(m.textures)) if (/^layer\d+$/.test(k)) refs.add(`#${k}`);
    for (const r of refs) {
      const t = resolveTexture(m.textures, r);
      if (!t) {
        if (strict) errors.push(`модель ${key}: текстура ${r} не задана — грань будет пурпурно-чёрной`);
        continue;
      }
      if (findResource(layers, texturePath(t))) continue;
      if (absentNs(t)) warns.push(`модель ${key}: текстура ${t} — мода ${resLoc(t).ns} нет в сборке (совместимость)`);
      else err(`модель ${key}: нет текстуры ${texturePath(t)}`);
    }
    if (particle && m.elements && !resolveTexture(m.textures, '#particle'))
      warns.push(`модель ${key}: нет текстуры particle (частицы при ломании — пурпурные)`);
    if (m.loader && !m.elements) info.push(`модель ${key}: loader ${m.loader} — геометрия не проверялась`);
    return m;
  };

  // Блоки: блокстейт ↔ свойства, модели, переводы, добыча
  let statesChecked = 0;
  for (const [id, b] of [...blocks].sort()) {
    const { ns, path: p } = resLoc(id);
    const bs = readJsonRes([own], blockstatePath(id));
    let props = null;
    if (b.cls) {
      const r = blockProperties(load, b.cls);
      // Не все свойства разобраны — сверять нечего: лишнее «нет свойства» и «нет варианта» были бы ложными
      props = r.props.incomplete ? null : r.props;
      for (const n of r.notes) warns.push(`${id}: ${n} — блокстейт со свойствами не сверялся`);
    }
    if (!bs) {
      errors.push(
        `${id}: нет блокстейта ${blockstatePath(id)} — блок будет пурпурно-чёрным (${[...b.why].join(', ')})`,
      );
    } else if (!bs.json) errors.push(`${blockstatePath(id)}: JSON не разобрался — ${bs.error}`);
    else {
      const j = bs.json;
      if (!j.variants && !j.multipart) errors.push(`${blockstatePath(id)}: нет ни variants, ни multipart`);
      const used = statePropsOf(j);
      if (props) {
        const known = new Map(props.map((x) => [x.name, x.values]));
        for (const [k, vals] of used) {
          if (!known.has(k)) {
            errors.push(
              `${id}: в блокстейте свойство ${k}, которого у блока нет (свойства: ${props.map((x) => x.name).join(', ') || '—'})`,
            );
            continue;
          }
          const ok = known.get(k);
          if (ok)
            for (const v of vals)
              if (!ok.includes(v)) errors.push(`${id}: ${k}=${v} — нет такого значения (есть ${ok.join(', ')})`);
        }
        // Покрытие: каждое состояние должно найти вариант (как BlockModelDefinition: указанные свойства совпадают)
        if (j.variants && props.some((x) => !x.values))
          warns.push(
            `${id}: значения свойств ${props
              .filter((x) => !x.values)
              .map((x) => `${x.name} (${x.note ?? '?'})`)
              .join(', ')} не разобраны — покрытие блокстейта не проверялось`,
          );
        else if (j.variants) {
          const full = props;
          let total = 1;
          for (const x of full) total *= x.values.length;
          if (total > 200000) warns.push(`${id}: ${total} состояний — покрытие не перебиралось`);
          else {
            const keys = Object.keys(j.variants).map(parseState);
            const missing = [];
            const st = {};
            const rec = (i) => {
              if (i === full.length) {
                statesChecked++;
                if (!keys.some((k) => Object.entries(k).every(([pp, v]) => st[pp] === v))) missing.push(stateText(st));
                return;
              }
              for (const v of full[i].values) {
                st[full[i].name] = v;
                rec(i + 1);
              }
            };
            rec(0);
            if (missing.length)
              errors.push(
                `${id}: ${missing.length} из ${total} состояний без варианта в блокстейте (пурпурные в игре), например: ${missing.slice(0, 4).join(' | ')}`,
              );
          }
        }
        for (const x of props) if (x.note && x.values) warns.push(`${id}: ${x.name} — ${x.note}`);
      }
      // particle берётся из модели варианта, у multipart — из первой части
      const models = new Map();
      for (const v of Object.values(j.variants ?? {}))
        for (const x of [v].flat()) if (x?.model) models.set(x.model, true);
      (j.multipart ?? []).forEach((part, k) => {
        for (const x of [part.apply].flat()) if (x?.model) models.set(x.model, models.get(x.model) || k === 0);
      });
      for (const [mid, particle] of models) checkModel(mid, blockstatePath(id), true, particle);
    }
    // Ключ названия — Util.makeDescriptionId: «/» в id становится «.»
    needKey(`block.${ns}.${p.replaceAll('/', '.')}`, 'название блока');
    // Блок жидкости (жидкость с тем же id, fluid/…, единственное свойство level) добычи не имеет
    const fluidLike =
      tags().fluids.has(id) ||
      p.startsWith('fluid/') ||
      (bs?.json?.variants && [...statePropsOf(bs.json).keys()].join() === 'level');
    if (!fluidLike && !findResource([own], `data/${ns}/loot_table/blocks/${p}.json`))
      (target.only.addon ? warns : info).push(
        `${id}: нет data/${ns}/loot_table/blocks/${p}.json — блок ничего не роняет (если не роняет кодом)`,
      );
    if (!items.has(id) && !fluidLike && !findResource([own], modelPath(`${ns}:item/${p}`)))
      info.push(`${id}: модели предмета нет — если у блока есть предмет, в инвентаре он будет пурпурным`);
  }

  // Предметы: модель и название (у предмета блока название блока)
  // Предмет известен только по модели (блок с моделью предмета, регистрация не разобрана) — может и не быть
  // зарегистрирован (у TFC коралловых «настенных вееров» предметов нет): тогда модель не грузится, ошибки — к сведению
  for (const [id, e] of [...items].sort()) {
    const { ns, path: p } = resLoc(id);
    const sure = Boolean(e.cls) || e.why.has('регистрация в коде');
    checkModel(`${ns}:item/${p}`, `предмет ${id}`, sure);
    if (sure && !blocks.has(id)) needKey(`item.${ns}.${p.replaceAll('/', '.')}`, 'название предмета');
  }

  // Прочие модели аддона — не упомянутые нигде (могут быть PartialModel или мусор)
  const partialIds = new Set();
  for (const pm of code.partials) {
    const [s1, s2] = pm.strs.slice(-2);
    let mid = null;
    if (pm.strs.length >= 2 && !s2.includes(':') && /^[a-z0-9_.-]+$/.test(s1)) mid = `${s1}:${s2}`;
    else if (pm.strs.length) mid = pm.strs.at(-1).includes(':') ? pm.strs.at(-1) : `${main}:${pm.strs.at(-1)}`;
    if (!mid) {
      info.push(`${pm.where}: PartialModel.of — путь модели собирается кодом, не проверен`);
      continue;
    }
    partialIds.add(`${resLoc(mid).ns}:${resLoc(mid).path}`);
    checkModel(mid, `PartialModel.of в ${pm.where}`);
  }
  for (const ns of spaces)
    for (const p of own.list(`assets/${ns}/models/`)) {
      if (!p.endsWith('.json')) continue;
      const mid = `${ns}:${p.slice(`assets/${ns}/models/`.length, -5)}`;
      if (!checkedModels.has(mid) && !partialIds.has(mid)) {
        checkModel(mid, 'файл модели', false);
      }
    }

  // Ключи перевода из кода
  const prefixes = spaces.flatMap((ns) => [`block.${ns}.`, `item.${ns}.`, `${ns}.`]);
  const keyRe = /^[a-z0-9_-]+(\.[a-z0-9_/-]+)+$/;
  const foreign = new Map(); // ns → lang
  const mcLayers = layers.filter((l) => l.kind === 'minecraft');
  const foreignLang = (ns) => {
    // en_us Minecraft — из его ресурсов: в jar модов бывают огрызки assets/minecraft/lang
    if (!foreign.has(ns))
      foreign.set(
        ns,
        readJsonRes(ns === 'minecraft' ? mcLayers : layers, `assets/${ns}/lang/en_us.json`)?.json ?? null,
      );
    return foreign.get(ns);
  };
  const seenKeys = new Set();
  // Первые части своих ключей (miner_belt из miner_belt.on), кроме общих block/item/…
  const langPrefixes = new Set(
    Object.keys(lang.en_us)
      .map((k) => k.split('.')[0])
      .filter(
        (x) =>
          !/^(block|item|entity|effect|enchantment|biome|fluid|fluid_type|container|gui|key|itemGroup|death|subtitles|advancements|tag|stat|attribute|commands|chat|menu|options|tooltip)$/.test(
            x,
          ),
      ),
  );
  let codeKeys = 0;
  for (const s of code.strings) {
    if (s.concat) {
      const parts = s.value.split('\u0001');
      const pre = parts[0];
      if (pre && prefixes.some((x) => pre.startsWith(x)) && pre.endsWith('.')) {
        const n = Object.keys(lang.en_us).filter((k) => k.startsWith(pre)).length;
        info.push(`${s.where}: ключ собирается кодом «${pre}…» — в en_us таких ключей ${n}`);
      } else if (!pre && parts.length === 2 && /^\.[a-z0-9_.]+$/.test(parts[1])) {
        const suf = parts[1];
        const base = Object.keys(lang.en_us).filter((k) => /^(block|item)\./.test(k) && k.split('.').length === 3);
        const without = base.filter((k) => !(`${k}${suf}` in lang.en_us));
        if (!seenKeys.has(suf) && without.length < base.length) {
          seenKeys.add(suf);
          info.push(
            `${s.where}: ключ «<ключ предмета>${suf}» собирается кодом — есть у ${base.length - without.length} из ${base.length} названий${without.length ? `; нет у ${without.slice(0, 8).join(', ')}` : ''}`,
          );
        }
      }
      continue;
    }
    const v = s.value;
    if (s.key && /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_/-]+)+$/.test(v)) {
      // Передаётся в Component.translatable и т. п. — ключ при любом префиксе (miner_belt.on, тернарный оператор)
      if (seenKeys.has(v)) continue;
      seenKeys.add(v);
      const parts = v.split('.');
      const ns = parts[0] === 'block' || parts[0] === 'item' ? parts[1] : parts[0];
      const ownKey = v in lang.en_us || v in lang.ru_ru || spaces.includes(ns) || langPrefixes.has(parts[0]);
      const fl = !ownKey && mods().has(ns) && ns !== 'minecraft' ? foreignLang(ns) : null;
      const mc = foreignLang('minecraft');
      if (ownKey) {
        codeKeys++;
        needKey(v, `Component.translatable в ${s.where}`);
      } else if ((fl && v in fl) || (mc && v in mc)) codeKeys++;
      else if (fl) warns.push(`${s.where}: ключ ${v} из чужого namespace — в en_us ${ns} его нет`);
      else
        (target.only.addon ? warns : info).push(
          `${s.where}: ключ ${v} — нет ни в переводах мода, ни в Minecraft${mc ? '' : ' (ресурсы Minecraft не найдены)'}`,
        );
      continue;
    }
    if (!keyRe.test(v) || /\.(json|png|toml|class|js|nbt)$/.test(v) || seenKeys.has(v)) continue;
    // Строка с префиксом ключей мода (miner_belt.…), но не прямо в translatable — ключ, если перевод есть
    if (langPrefixes.has(v.split('.')[0]) && !prefixes.some((x) => v.startsWith(x))) {
      seenKeys.add(v);
      if (v in lang.en_us) codeKeys++;
      else
        info.push(`${s.where}: строка ${v} похожа на ключ перевода мода, но в en_us её нет — проверьте, ключ ли это`);
      continue;
    }
    if (prefixes.some((x) => v.startsWith(x))) {
      seenKeys.add(v);
      codeKeys++;
      needKey(v, `строка в ${s.where}`);
      continue;
    }
    const ns = v.split('.')[0];
    if (v.split('.').length >= 3 && mods().has(ns)) {
      seenKeys.add(v);
      const fl = foreignLang(ns);
      if (fl && !(v in fl)) warns.push(`${s.where}: ключ ${v} из чужого namespace — в en_us ${ns} его нет`);
      else if (fl) codeKeys++;
    }
  }
  const onlyEn = Object.keys(lang.en_us).filter((k) => !(k in lang.ru_ru));
  const onlyRu = Object.keys(lang.ru_ru).filter((k) => !(k in lang.en_us));
  if (onlyEn.length) warns.push(`есть в en_us, нет в ru_ru (${onlyEn.length}): ${onlyEn.slice(0, 10).join(', ')}`);
  if (onlyRu.length) warns.push(`есть в ru_ru, нет в en_us (${onlyRu.length}): ${onlyRu.slice(0, 10).join(', ')}`);

  const test = a.filter ? (x) => x.toLowerCase().includes(String(a.filter).toLowerCase()) : () => true;
  const uniq = (l) => [...new Set(l)].filter(test);
  const cap = Math.min(500, Math.max(5, Number(a.limit ?? 60) | 0));
  const list = (l) => [
    ...l.slice(0, cap).map((x) => `• ${x}`),
    ...(l.length > cap ? [`… ещё ${l.length - cap} (filter=<слова> — отбор, limit — больше строк)`] : []),
  ];
  const out = [
    `Проверка ресурсов: ${target.label}; namespace ${spaces.join(', ') || '—'}`,
    `проверено: блоков ${blocks.size} (состояний ${statesChecked}), предметов ${items.size}, моделей ${checkedModels.size}, ключей перевода ${keysChecked.size} (из кода ${codeKeys}), PartialModel ${code.partials.length}; классов ${src.names.length}, регистраций в коде ${regs.length}`,
  ];
  const E = uniq(errors);
  const W = uniq(warns);
  const I = uniq(info);
  out.push(E.length ? `\n❌ Ошибки (${E.length}):` : '\n✓ Ошибок нет.');
  out.push(...list(E));
  if (W.length) out.push(`\n⚠ Предупреждения (${W.length}):`, ...list(W));
  if (I.length && a.verbose !== false) out.push(`\nℹ К сведению (${I.length}):`, ...list(I));
  if (a.props) {
    out.push('\nСвойства блоков (из байткода):');
    for (const [id, b] of [...blocks].sort()) {
      if (!b.cls) continue;
      const r = blockProperties(load, b.cls);
      out.push(
        `• ${id} (${b.cls.split('/').pop()}): ${r.props.map((x) => `${x.name}=${x.values?.join('|') ?? '?'} [${x.from}]`).join('; ') || 'без свойств'}`,
      );
    }
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- список

export const TOOLS = [
  {
    name: 'model_render',
    description:
      'Render a block or item model as a PNG image (no client): blockstate → variant (state) → model with parent, variant and element x/y rotations, face uv and rotation, display.gui; item/generated items — layers. GeckoLib models (assets/<ns>/geo/*.geo.json; kind=geo or id ns:geo/…) — bones and cubes as in GeckoLib 4.8 with texture=, armour over a player silhouette; text lists bones, cube count, faces with UV outside the texture or on transparent areas. Resolves by layer: resource packs, KubeJS, addon folders tools/<mod>/src/main/resources (addon from a git worktree — addon=<path>), mod jars, Minecraft. Text: model chain, source of each texture, warnings (tint, loader, missing texture).',
    inputSchema: {
      type: 'object',
      properties: {
        id: str(
          'block/item id (ee_extras:four_core_termination), model (ns:block/…) with kind=model, or GeckoLib model (miner_tools:geo/miner_helmet.geo.json)',
        ),
        kind: {
          type: 'string',
          enum: ['block', 'item', 'model', 'geo'],
          description:
            'what to draw (default: block if it has a blockstate, else item, else model; id with geo/ or .geo.json — GeckoLib model)',
        },
        texture: str(
          'for geo: model texture — ns:textures/models/armor/x.png, assets/ns/textures/….png or ns:entity/x (without it — search by model name in item/, entity/, armor/, models/armor/, block/)',
        ),
        bones: str('for geo: only these bones with children, comma-separated (armorHead)'),
        silhouette: {
          type: 'string',
          enum: ['auto', 'all', 'none'],
          description:
            'for geo: translucent player silhouette under armour — auto (parts under armorHead/armorBody/… bones with cubes, default), all (whole player), none',
        },
        state: str('block state: facing=north,roll=true (missing properties — first matching variant)'),
        view: {
          type: 'string',
          enum: ['gui', 'top', 'bottom', 'north', 'south', 'east', 'west'],
          description: 'view: gui — as in inventory (default), top — from above, a side — from that side',
        },
        size: num('image size in pixels (256, max 1024)'),
        addon: str(
          'addon folder (path, e.g. .claude/worktrees/…/tools/miner-tools-mod, or a name in tools/): resources are taken from it instead of tools/ of the main checkout',
        ),
      },
      required: ['id'],
    },
    handler: modelRender,
  },
  {
    name: 'texture_get',
    description:
      'Texture as an image (nearest-neighbour upscale) and palette: frequent colours with shares, size, animation frames, source (resource pack / KubeJS / addon / jar / Minecraft).',
    inputSchema: {
      type: 'object',
      properties: {
        path: str('ns:block/x or assets/ns/textures/….png'),
        size: num('image size on the longer side (256)'),
        colors: num('how many palette colours (12, max 32)'),
        addon: str('addon folder (path or name in tools/) instead of tools/ of the main checkout — as in model_render'),
      },
      required: ['path'],
    },
    handler: textureGet,
  },
  {
    name: 'resources_check',
    description:
      "Check a mod's or addon's resources without a client: every block has a blockstate covering all property combinations (properties from createBlockStateDefinition bytecode incl. ancestors), property values valid, models and parents exist (incl. foreign namespaces and Minecraft), textures exist, element coordinates and angles valid, items have models, translation keys from code (everything passed to Component.translatable — incl. ternary branches — and strings with the mod's key prefixes) and block/item names exist in en_us and ru_ru (missing in ru_ru is an error for an addon), PartialModel.of points to a model, blocks have loot.",
    inputSchema: {
      type: 'object',
      properties: {
        addon: str(
          'addon: folder in tools/ (ee-extras-mod) or path to the mod folder; classes — build/classes/java/main',
        ),
        mod: str('or a pack mod: id or jar'),
        props: { type: 'boolean', description: 'show block properties from bytecode' },
        filter: str('only messages with these words (e.g. a block id)'),
        limit: num('lines per section (60)'),
        verbose: { type: 'boolean', description: 'show info-level messages (default yes)' },
      },
    },
    handler: resourcesCheck,
  },
];
