#!/usr/bin/env node
/**
 * Книга квестов FTB Quests → public/quests.json (раздел справочника «Квесты»).
 *
 *   npm run quests                     — из кеша сборки (~/.cache/tfc-plans/pack, npm run pack:fetch)
 *   npm run quests -- <папка сборки>   — из папки версии (там config/ftbquests/quests)
 *   … --out <папка>                    — не в public/
 *
 * На сайт файл выкладывает сервер сборки (часть quests в npm run pack), как остальные данные сборки.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildQuestBook } from '@tfc/core/ftbQuests';
import { parseSnbt } from '@tfc/core/snbt';
import { PACK_CACHE } from './pack-cache.mjs';
import { DEFAULT_OUT } from './mods.mjs';

export const QUESTS_DIR = path.join('config', 'ftbquests', 'quests');
export const QUESTS_OUT = 'quests.json';

const readSnbt = (file) => parseSnbt(fs.readFileSync(file, 'utf8'));

/** Файлы книги из папки config/ftbquests/quests: { groups, chapters, lang } для buildQuestBook */
export function readQuestFiles(dir) {
  const chaptersDir = path.join(dir, 'chapters');
  const langDir = path.join(dir, 'lang');
  const groupsFile = path.join(dir, 'chapter_groups.snbt');
  const lang = {};
  if (fs.existsSync(langDir))
    for (const f of fs.readdirSync(langDir))
      if (/^\w+\.snbt$/.test(f)) lang[f.slice(0, -5).toLowerCase()] = readSnbt(path.join(langDir, f));
  return {
    groups: fs.existsSync(groupsFile) ? readSnbt(groupsFile) : undefined,
    chapters: fs.existsSync(chaptersDir)
      ? fs
          .readdirSync(chaptersDir)
          .filter((f) => f.endsWith('.snbt'))
          .sort()
          .map((f) => readSnbt(path.join(chaptersDir, f)))
      : [],
    lang,
  };
}

/** Собирает quests.json; root — папка сборки (в ней config/). Нет книги — null. */
export function buildQuests({ root, outDir = DEFAULT_OUT }) {
  const dir = path.join(root, QUESTS_DIR);
  if (!fs.existsSync(dir)) return null;
  const book = buildQuestBook(readQuestFiles(dir));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, QUESTS_OUT), JSON.stringify(book));
  const quests = book.chapters.reduce((n, c) => n + c.quests.length, 0);
  console.log(`[quests] ${book.chapters.length} глав, ${quests} квестов → ${path.join(outDir, QUESTS_OUT)}`);
  return book;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const outAt = argv.indexOf('--out');
  const outDir = outAt >= 0 ? argv[outAt + 1] : DEFAULT_OUT;
  const root = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out') ?? PACK_CACHE;
  if (!buildQuests({ root, outDir })) {
    console.error(`[quests] нет ${path.join(root, QUESTS_DIR)}`);
    process.exit(1);
  }
}
