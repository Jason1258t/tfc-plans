/**
 * Объёмные иконки предметов-блоков: у предмета со своей моделью из элементов (блоки, детали машин) иконка — сама модель
 * под углом инвентаря, а не одна текстура (у модели с развёрткой «текстура» — лист всех граней сразу, на сайте это
 * выглядело кашей). Рисует общий генератор MCP (scripts/mcp/render.mjs: сглаживание 4×, те же правила, что у
 * model_render и иконок аддонов), в том числе модели OBJ, composite, separate_transforms и conf_sides IE. Предметы из
 * слоёв (item/generated), рисуемые кодом (builtin/entity) и прочие загрузчики — как раньше, текстурой.
 *
 * Кеш — по содержимому: хеш файлов цепочки моделей и текстур + размер; одинаковая модель не рисуется дважды
 * (картинка лежит в <cache>/icons3d/<хеш>.png и копируется в icons/<ns>/render/<путь>.png).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fluidLook } from '../mcp/fluids.mjs';
import {
  DRAWN_LOADERS,
  codeBlock,
  codeModel,
  flatLoaderSpecs,
  guiModel,
  ieObjDrawable,
  palettedTextures,
  renderFlat,
  renderGenerated,
  renderModel,
} from '../mcp/render.mjs';
import { loadModel, modJarsLayer, platformLayers, resolveTexture } from '../mcp/resources.mjs';

/** Поднять, если изменился рисунок (генератор, размер) — старый кеш не подойдёт */
// 2 — модели OBJ, composite, separate_transforms, conf_sides IE; 3 — без пустых картинок; 4 — без ie_obj и пурпурных;
// 5 — поворот вида как в игре (было зеркально), окраска tintindex, ie_obj с переворотом v, z у display.gui;
// 6 — текстуры атласа (paletted_permutations), головы дракона и пиглина, жидкости IE по make(…_still), загрузчики IE;
// 7 — барометр Create Submarine (поза частей affine)
const VERSION = 7;

/**
 * findAsset(ns, rel) — файл ресурса из распакованных jar (как в mods.mjs), outIcons — папка icons/ сайта,
 * cacheDir — кеш картинок. Возвращает render(ns, p) → путь иконки внутри icons/ или null (рисовать нечего).
 */
export function makeRenderer({ findAsset, outIcons, cacheDir, size = 96 }) {
  // Слой ресурсов для генератора: assets/<ns>/<rel> → распакованный файл
  const file = (p) => {
    const m = p.match(/^assets\/([^/]+)\/(.+)$/);
    return m ? findAsset(m[1], m[2]) : null;
  };
  const layer = {
    label: 'jar сборки',
    kind: 'jar',
    has: (p) => Boolean(file(p)),
    read: (p) => {
      const f = file(p);
      return f ? fs.readFileSync(f) : null;
    },
    list: () => [],
  };
  // Запасные слои: jar модов (блокстейты — кеш их не распаковывает) и ресурсы Minecraft и NeoForge из кеша сборки
  // аддонов (текстуры сущностей, модели neoforge:item/*)
  const layers = [layer, modJarsLayer(), ...platformLayers()];
  const dir = path.join(cacheDir, 'icons3d');
  fs.mkdirSync(dir, { recursive: true });
  const stats = { drawn: 0, cached: 0, failed: 0, code: 0, codeKinds: new Map(), noFluid: [], failedIds: [] };

  /** Файл текстуры по id (ns:path) — в хеш */
  const texFile = (t) => {
    const [ns, p] = t.includes(':') ? t.split(':', 2) : ['minecraft', t];
    return findAsset(ns, `textures/${p}.png`);
  };
  /** Содержимое текстуры для хеша: файл кеша или запасной слой */
  const texData = (t) => {
    const f = texFile(t);
    if (f) return fs.readFileSync(f);
    const [ns, p] = t.includes(':') ? t.split(':', 2) : ['minecraft', t];
    for (const l of layers.slice(1)) {
      const d = l.read(`assets/${ns}/textures/${p}.png`);
      if (d) return d;
    }
    // Текстура из атласа (paletted_permutations): основа и обе палитры
    const pal = palettedTextures().get(`${ns}:${p}`);
    if (pal) {
      const parts = [pal.base, pal.key, pal.perm].map((x) => texData(x));
      if (parts.every(Boolean)) return Buffer.concat(parts);
    }
    return null;
  };
  /** Слой предмета item/generated — текстура, которую делает атлас (палитры TFC: пиломатериалы, лодки…) */
  const paletteLayer = (model) =>
    Object.entries(model.textures).some(([k, v]) => {
      const t = /^layer\d+$/.test(k) && resolveTexture(model.textures, v);
      return t && !texFile(t) && palettedTextures().has(t.includes(':') ? t : `minecraft:${t}`);
    });

  function key(model, flat) {
    const h = crypto.createHash('sha1').update(`${VERSION}|${size}`);
    // Плоский предмет с загрузчиком: слои (текстуры, маски, окраска жидкости)
    for (const sp of flat?.specs ?? []) {
      h.update(JSON.stringify(sp));
      for (const t of [sp.id, sp.mask]) {
        const d = t && texData(t);
        if (d) h.update(d);
      }
    }
    for (const c of model.chain) {
      const [ns, p] = c.id.split(':');
      const f = findAsset(ns, `models/${p}.json`);
      if (f) h.update(fs.readFileSync(f));
    }
    const deref = (v, n = 0) =>
      typeof v === 'string' && v.startsWith('#') && n < 10 ? deref(model.textures[v.slice(1)], n + 1) : v;
    for (const v of Object.values(model.textures)) {
      const t = deref(v);
      if (typeof t !== 'string' || t.startsWith('#')) continue;
      const d = texData(t);
      if (d) h.update(t).update(d);
    }
    // Модель сущности: текстуры её граней
    for (const t of new Set((model.quads ?? []).map((q) => q.tex))) {
      const d = texData(t);
      h.update(t);
      if (d) h.update(d);
    }
    if (model.drawnBy) h.update(model.drawnBy);
    // …и окраска (знамёна разных цветов — одни текстуры)
    h.update(
      JSON.stringify([...new Set((model.quads ?? []).map((q) => `${q.tex}|${q.tint ?? ''}|${q.overlay ? 1 : 0}`))]),
    );
    // Окраска tintindex (рюкзаки)
    if (model.tints) h.update(JSON.stringify(model.tints));
    // Части модели блока (ящики): их цепочки, текстуры и повороты
    for (const pt of model.codeParts ?? []) {
      h.update(JSON.stringify([pt.x, pt.y, pt.mat, pt.affine, pt.model.textures]));
      // Грани модели сущности внутри части (рыба и вода барометра): их текстуры и окраска
      for (const t of new Set((pt.model.quads ?? []).map((q) => q.tex))) {
        const d = texData(t);
        h.update(`${t}|`);
        if (d) h.update(d);
      }
      if (pt.model.quads) h.update(JSON.stringify(pt.model.quads.map((q) => [q.P, q.uv, q.tint ?? null])));
      for (const c of pt.model.chain) {
        const [cns, cp] = c.id.split(':');
        const f = findAsset(cns, `models/${cp}.json`);
        if (f) h.update(fs.readFileSync(f));
      }
      for (const v of Object.values(pt.model.textures)) {
        const d = typeof v === 'string' && !v.startsWith('#') && texData(v);
        if (d) h.update(d);
      }
    }
    // Загрузчик: его поля (части composite, имя текстур conf_sides) и файл OBJ с материалами
    if (model.loaderJson) {
      h.update(JSON.stringify(model.loaderJson));
      const obj = typeof model.loaderJson.model === 'string' ? model.loaderJson.model.split(':') : null;
      const f = obj && findAsset(obj.length > 1 ? obj[0] : 'minecraft', obj[obj.length - 1]);
      if (f) h.update(fs.readFileSync(f));
    }
    return h.digest('hex');
  }

  function render(ns, p) {
    const own = loadModel(layers, `${ns}:item/${p}`);
    if (own.missing.length || own.errors.length) return null;
    // separate_transforms: в инвентаре — своя модель (бывает и плоской, из слоёв)
    let model = guiModel(layers, own);
    // Рисуется кодом (builtin/entity) — реестр scripts/mcp/models/: модели сущностей (сундуки, головы…) или модели
    // блоков с поворотом из кода предмета (ящики Functional Storage, барометр Create Submarine)
    const code = model.entity ? codeModel(layers, `${ns}:${p}`, model) : null;
    if (code?.quads) model = { ...model, entity: false, elements: null, quads: code.quads, drawnBy: code.drawnBy };
    else if (code?.parts)
      model = { ...code.parts[0].model, entity: false, codeParts: code.parts, drawnBy: code.drawnBy };
    // Плоские загрузчики: вёдра и сосуды с жидкостью, броня TFC (вид без отделки, как в JEI)
    const loaderFlat = flatLoaderSpecs(layers, model, `${ns}:${p}`, fluidLook);
    if (loaderFlat && !loaderFlat.specs.length) return null;
    if (loaderFlat?.wanted && !loaderFlat.fluid) stats.noFluid.push(loaderFlat.wanted);
    // Плоский предмет рисуем, только если его текстура не лежит файлом: вид в инвентаре своей моделью или слой из атласа
    const flat = (model.generated && (model !== own || paletteLayer(model))) || Boolean(loaderFlat);
    if (model.generated && !flat) return null;
    // Рисуется кодом (builtin/entity) или загрузчиком, который генератор не умеет
    // ie_obj с callbacks, чей код не перенесён (render.mjs IE_ITEM_CALLBACKS), — в файле все варианты сразу
    if (
      (!loaderFlat && model.entity) ||
      (model.loader === 'immersiveengineering:ie_obj' && !ieObjDrawable(model)) ||
      (!loaderFlat && model.loader && !DRAWN_LOADERS.has(model.loader))
    ) {
      stats.code++;
      const kind = model.entity ? `builtin/entity (${model.chain.at(-2)?.id ?? '?'})` : `загрузчик ${model.loader}`;
      stats.codeKinds.set(kind, (stats.codeKinds.get(kind) ?? 0) + 1);
      return null;
    }
    if (!flat && !model.elements?.length && !model.loader && !model.quads) return null;
    let png;
    const cached = path.join(dir, `${key(model, loaderFlat)}.png`);
    if (fs.existsSync(cached)) {
      png = fs.readFileSync(cached);
      stats.cached++;
    } else {
      try {
        const r = loaderFlat
          ? renderFlat(layers, loaderFlat.specs, size)
          : flat
            ? renderGenerated(layers, model, size)
            : renderModel(layers, model.codeParts ?? [{ model, x: 0, y: 0 }], { size });
        // Пусто (нет файла OBJ, нет граней) — не иконка: остаётся текстура
        // Нет текстуры — в игре была бы пурпурная клетка, иконкой это не берём
        png = r.warnings.some((w) => /нет элементов|нет файла|нет граней|нет текстуры|нет материалов/.test(w))
          ? null
          : r.png;
      } catch {
        png = null;
      }
      if (!png) {
        stats.failed++;
        stats.failedIds.push(`${ns}:${p}`);
        return null;
      }
      fs.writeFileSync(cached, png);
      stats.drawn++;
    }
    const rel = `${ns}/render/${p}`;
    const target = path.join(outIcons, `${rel}.png`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, png);
    return rel;
  }

  /** Блок без модели, нарисованный кодом предмета (сундуки) — для block-models.mjs: { rotate, variants } или null */
  function blockCode(ns, p) {
    const own = loadModel(layers, `${ns}:item/${p}`);
    if (own.missing.length || own.errors.length) return null;
    return codeBlock(layers, `${ns}:${p}`, guiModel(layers, own));
  }

  return { render, stats, layers, blockCode };
}
