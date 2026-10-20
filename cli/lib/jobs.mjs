/**
 * Задания сервера сборки (хост): сборка данных сайта и публикация — список, ход по логу, итог простыми словами.
 * API — server/pack-server/README.md (POST /admin/rebuild, POST /admin/publish, GET /jobs, GET /jobs/:id?from=N).
 */
import { bold, date, dim, green, mb, red, yellow } from './ui.mjs';

export const PARTS = ['mods', 'kubejs', 'config', 'world'];
export const PUBLISH = ['none', 'dry-run', 'live'];

const STATE = {
  queued: yellow('в очереди'),
  running: yellow('идёт'),
  done: green('готово'),
  failed: red('ошибка'),
};
const KIND = { build: 'сборка', publish: 'публикация' };
const PUBLISH_TITLE = { none: 'без публикации', 'dry-run': 'пробная публикация', live: yellow('ВЫКЛАДКА НА САЙТ') };

const ms = (iso) => (iso ? Date.parse(iso) : null);
function duration(j) {
  const a = ms(j.startedAt);
  if (!a) return '';
  const s = Math.round(((ms(j.finishedAt) ?? Date.now()) - a) / 1000);
  return s < 60 ? `${s} с` : `${Math.floor(s / 60)} мин ${s % 60} с`;
}

const jobTitle = (j) =>
  `${KIND[j.kind] ?? j.kind}${j.parts?.length ? ` (${j.parts.join(', ')})` : ''}, ${PUBLISH_TITLE[j.publish] ?? j.publish}` +
  `${j.pull ? ', с git pull' : ''}`;

/** Части из аргументов: «mods kubejs» или «mods,kubejs» */
export function parseParts(args) {
  const parts = [...new Set(args.flatMap((p) => p.split(',')).filter(Boolean))];
  const bad = parts.filter((p) => !PARTS.includes(p));
  if (bad.length) throw new Error(`нет такой части: ${bad.join(', ')} — можно ${PARTS.join(', ')}`);
  return parts;
}

export async function printJobs(api) {
  const { running, queued, jobs } = await api.get('/jobs');
  if (!jobs.length) return console.log('Заданий ещё не было.');
  for (const j of jobs.slice(0, 20))
    console.log(
      `  ${j.id}  ${STATE[j.state] ?? j.state}  ${jobTitle(j)} ${dim(`снимок ${j.snapshot} · ${date(ms(j.createdAt))} · ${j.by ?? '?'}${duration(j) ? ` · ${duration(j)}` : ''}`)}` +
        (j.error ? `\n      ${red(j.error)}` : ''),
    );
  if (jobs.length > 20) console.log(dim(`  … ещё ${jobs.length - 20} старых`));
  if (running) console.log(dim(`Сейчас идёт ${running}${queued.length ? `, в очереди ${queued.length}` : ''}.`));
  console.log(dim('Подробно: tfc admin jobs <id> (--follow — следить за ходом)'));
}

/** Итог задания: что собрано и что изменится (изменилось) на сайте */
export function printResult(j) {
  const r = j.result;
  if (j.state === 'failed') console.log(red(`Задание не удалось: ${j.error ?? 'причина в логе'}`));
  if (!r) return;
  if (r.build) {
    const b = r.build;
    console.log(
      `${bold('Собрано:')} ${b.files} файлов данных, ${mb(b.bytes)}, части ${b.parts.join(', ')}, за ${b.seconds} с` +
        dim(`${b.commit ? ` · код ${b.commit}` : ''}`),
    );
  }
  const p = r.publish;
  if (p) {
    console.log(
      bold(p.dryRun ? 'Пробная публикация — на сайте ничего не менялось. Выложилось бы:' : 'Публикация на сайт:'),
    );
    // «Обновления» на сайте (packUpdates)
    if (p.packUpdate) {
      const m = p.packUpdate.mods;
      const t = p.packUpdate.totals ?? {};
      console.log(
        `  «Обновления сборки»: новая запись — моды +${m.added} −${m.removed} ~${m.updated}` +
          dim(
            `; предметы +${t.itemsAdded ?? 0} −${t.itemsRemoved ?? 0}, рецепты +${t.recipesAdded ?? 0} −${t.recipesRemoved ?? 0} ~${t.recipesChanged ?? 0}`,
          ),
      );
    } else if ('packUpdate' in p) console.log('  «Обновления сборки»: без новой записи (моды и рецепты не менялись)');
    // Firestore config
    if (p.config) {
      const w = p.config.write;
      const fresh = w.filter((d) => d.new).length;
      console.log(
        `  Настройки сборки (Firestore config): ${w.length ? `${p.dryRun ? 'записать' : 'записано'} ${w.length} из ${p.config.total}` : `без изменений (${p.config.total})`}` +
          (w.length ? dim(` — новых ${fresh}, изменённых ${w.length - fresh}`) : ''),
      );
      for (const d of w.slice(0, 10)) console.log(dim(`      ${d.new ? '+' : '~'} ${d.id}`));
      if (w.length > 10) console.log(dim(`      … ещё ${w.length - 10}`));
    }
    // Hosting
    const h = p.hosting;
    if (h) {
      const n = h.added + h.changed + h.removed;
      console.log(
        `  Файлы сайта: ${n ? `новых ${h.added}, изменённых ${h.changed}, убрать ${h.removed} (загрузить ≈${mb(h.uploadBytes)})` : 'данные на сайте уже такие'}` +
          dim(` из ${h.files}${h.stampOnly ? `; отличаются только меткой времени — не трогаю: ${h.stampOnly}` : ''}`),
      );
      for (const [sign, list] of [
        ['+', h.sample?.added],
        ['~', h.sample?.changed],
        ['−', h.sample?.removed],
      ])
        for (const f of (list ?? []).slice(0, 8)) console.log(dim(`      ${sign} ${f}`));
      if (!p.dryRun) console.log(h.deployed ? green('  Выложено на сайт.') : '  На сайт выкладывать было нечего.');
      else if (n || p.config?.write.length || p.packUpdate)
        console.log(dim(`Выложить это на сайт: tfc admin publish --live (только для текущей сборки ${j.snapshot})`));
    }
  }
  if (r.maxRssMb) console.log(dim(`Пик памяти сборки: ${r.maxRssMb} МБ`));
}

/** Показать задание; follow — дочитывать лог, пока не закончится */
export async function showJob(api, id, { follow = false, tail = 40, interval = 2000 } = {}) {
  const url = (from) => `/jobs/${encodeURIComponent(id)}?from=${from}`;
  let j = await api.get(url(0));
  console.log(
    `${bold(j.id)} — ${jobTitle(j)}, снимок ${j.snapshot}; ${STATE[j.state] ?? j.state}` +
      dim(` · ${date(ms(j.createdAt))} · ${j.by ?? '?'}${duration(j) ? ` · ${duration(j)}` : ''}`),
  );
  const finished = () => j.state === 'done' || j.state === 'failed';
  if (!follow || finished()) {
    const lines = j.log.split('\n');
    if (lines.at(-1) === '') lines.pop();
    if (lines.length > tail) console.log(dim(`  … лог: последние ${tail} строк из ${lines.length}`));
    for (const l of lines.slice(-tail)) console.log(dim(`  ${l}`));
    if (!finished()) console.log(dim(`Задание ещё идёт — следить: tfc admin jobs ${j.id} --follow`));
    printResult(j);
    return j;
  }

  console.log(dim('Ctrl+C — перестать смотреть; задание на сервере продолжится.'));
  // Сервер режет лог по байтам — печатаем только целые строки, чтобы не разрезать русскую букву
  let from = 0;
  for (;;) {
    const cut = finished() ? j.log.length : j.log.lastIndexOf('\n') + 1;
    const chunk = j.log.slice(0, cut);
    if (chunk) for (const l of chunk.split('\n').slice(0, chunk.endsWith('\n') ? -1 : undefined)) console.log(`  ${l}`);
    from += Buffer.byteLength(chunk);
    if (finished()) break;
    await new Promise((r) => setTimeout(r, interval));
    j = await api.get(url(from));
  }
  console.log(`${STATE[j.state]}${duration(j) ? dim(` за ${duration(j)}`) : ''}`);
  printResult(j);
  return j;
}
