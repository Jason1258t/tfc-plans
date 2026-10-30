/**
 * Цвета блоков для подборщика генератора построек → public/block-colors.json:
 *
 *   { v: 1, b: { "<id>": [L, a, b, пестрота, целый куб 0/1] } }
 *
 * Только предметы-блоки (it.b). Цвет — по текстуре боковой (северной) грани первой модели blockstate, как блок
 * выглядит в стене; нет модели — по текстуре предмета (it.t). Целый куб — модель из одного элемента 0…16.
 * Формулы — общие с сайтом (@tfc/core/building/color), поэтому подбор на сайте совпадает с этим файлом.
 */
import fs from 'node:fs';
import path from 'node:path';
import { textureStats } from '@tfc/core/building/color';
import { decodePng } from '../mcp/tools/map-png.mjs';

const round = (v) => Math.round(v * 10) / 10;

function readModels(dir, ns, cache) {
  if (!cache.has(ns)) {
    const p = path.join(dir, `${ns}.json`);
    cache.set(ns, fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);
  }
  return cache.get(ns);
}

/** Модель блока: целый ли куб и текстура боковой грани */
function blockLook(f, blockPath) {
  const b = f?.b?.[blockPath];
  const first = b?.v?.[0]?.[1]?.[0] ?? b?.mp?.find(([when]) => !when)?.[1]?.[0];
  if (!first || first[0] < 0) return null;
  const [geo, slots] = f.m[first[0]] ?? [];
  const els = f.geo[geo];
  if (!els?.length) return null;
  const full =
    els.length === 1 && els[0].f.every((v) => v === 0) && els[0].t.every((v) => v === 16) && !els[0].r ? 1 : 0;
  const face = els[0].faces?.north ?? els[0].faces?.south ?? Object.values(els[0].faces ?? {})[0];
  const tex = face ? f.tex[slots[face.s]] : null;
  return { full, tex };
}

function stats(iconsDir, tex) {
  const p = path.join(iconsDir, `${tex}.png`);
  if (!tex || !fs.existsSync(p)) return null;
  const img = decodePng(fs.readFileSync(p));
  // Анимированные текстуры — полоса кадров: берём первый квадрат
  const w = img.width;
  const h = Math.min(img.height, img.width);
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = (img.rgb[i] >> 16) & 255;
    rgba[i * 4 + 1] = (img.rgb[i] >> 8) & 255;
    rgba[i * 4 + 2] = img.rgb[i] & 255;
    rgba[i * 4 + 3] = img.a[i];
  }
  return textureStats(rgba, w, h);
}

export function writeBlockColors({ items, blockModelsDir, iconsDir, outFile }) {
  const cache = new Map();
  const out = {};
  let fromItem = 0;
  for (const it of items) {
    if (!it.b) continue;
    const [ns, p] = it.i.split(':');
    const look = blockLook(readModels(blockModelsDir, ns, cache), p);
    let s = look?.tex ? stats(iconsDir, look.tex) : null;
    if (!s && it.t) {
      s = stats(iconsDir, it.t);
      if (s) fromItem++;
    }
    if (!s) continue;
    out[it.i] = [round(s.lab[0]), round(s.lab[1]), round(s.lab[2]), round(s.spread), look?.full ?? 0];
  }
  fs.writeFileSync(outFile, JSON.stringify({ v: 1, b: out }));
  const rows = Object.values(out);
  return {
    count: rows.length,
    full: rows.filter((r) => r[4]).length,
    fromItem,
    kb: Math.round(fs.statSync(outFile).size / 1024),
  };
}

// Отдельный запуск по готовым данным: node scripts/mods/block-colors.mjs <public> [выход]
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const pub = process.argv[2] ?? 'public';
  const r = writeBlockColors({
    items: JSON.parse(fs.readFileSync(path.join(pub, 'items.json'), 'utf8')),
    blockModelsDir: path.join(pub, 'block-models'),
    iconsDir: path.join(pub, 'icons'),
    outFile: process.argv[3] ?? path.join(pub, 'block-colors.json'),
  });
  console.log(`цвета блоков: ${r.count} (целых кубов ${r.full}, по текстуре предмета ${r.fromItem}) — ${r.kb}KB`);
}
