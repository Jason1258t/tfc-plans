/**
 * Объёмные иконки предметов-блоков: у предмета со своей моделью из элементов (блоки, детали машин) иконка — сама модель
 * под углом инвентаря, а не одна текстура (у модели с развёрткой «текстура» — лист всех граней сразу, на сайте это
 * выглядело кашей). Рисует общий генератор MCP (scripts/mcp/render.mjs: сглаживание 4×, те же правила, что у
 * model_render и иконок аддонов). Предметы из слоёв (item/generated), модели с loader и рисуемые кодом — как раньше,
 * текстурой.
 *
 * Кеш — по содержимому: хеш файлов цепочки моделей и текстур + размер; одинаковая модель не рисуется дважды
 * (картинка лежит в <cache>/icons3d/<хеш>.png и копируется в icons/<ns>/render/<путь>.png).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { renderModel } from '../mcp/render.mjs';
import { loadModel } from '../mcp/resources.mjs';

/** Поднять, если изменился рисунок (генератор, размер) — старый кеш не подойдёт */
const VERSION = 1;

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
  const layers = [layer];
  const dir = path.join(cacheDir, 'icons3d');
  fs.mkdirSync(dir, { recursive: true });
  const stats = { drawn: 0, cached: 0, failed: 0, code: 0 };

  function key(model) {
    const h = crypto.createHash('sha1').update(`${VERSION}|${size}`);
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
      const [ns, p] = t.includes(':') ? t.split(':', 2) : ['minecraft', t];
      const f = findAsset(ns, `textures/${p}.png`);
      if (f) h.update(t).update(fs.readFileSync(f));
    }
    return h.digest('hex');
  }

  function render(ns, p) {
    const model = loadModel(layers, `${ns}:item/${p}`);
    if (model.generated || model.missing.length || model.errors.length) return null;
    // Рисуется кодом (builtin/entity) или своим загрузчиком (obj, IE) — генератор такие не умеет
    if (model.entity || model.loader) {
      stats.code++;
      return null;
    }
    if (!model.elements?.length) return null;
    let png;
    const cached = path.join(dir, `${key(model)}.png`);
    if (fs.existsSync(cached)) {
      png = fs.readFileSync(cached);
      stats.cached++;
    } else {
      try {
        png = renderModel(layers, [{ model, x: 0, y: 0 }], { size }).png;
      } catch {
        png = null;
      }
      if (!png) {
        stats.failed++;
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

  return { render, stats };
}
