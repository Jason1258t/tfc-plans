/**
 * Версии аддонов на сервере сборки: `tfc admin addon upload <jar…>` — залить jar версии (блоб) и записать версию
 * на сайте (Firestore addonVersions, новая — черновик; ченджлог пишут на сайте или MCP addon_version_put);
 * `tfc addons` — какие версии есть, что стоит в этой папке и что закреплено.
 */
import fs from 'node:fs';
import path from 'node:path';
import { compareVersions, sortVersions, STATUS_LABEL } from '../../src/lib/addonVersions.ts';
import { modInfoOf } from './jarid.mjs';
import { loadState } from './plan.mjs';
import { sha256File } from './scan.mjs';
import { bold, dim, green, red, yellow } from './ui.mjs';

/** Залить jar версий аддонов: id и версия — из neoforge.mods.toml jar (--id/--ver — вместо них) */
export async function uploadAddons(api, files, { id, version } = {}) {
  if (!files.length) throw new Error('tfc admin addon upload <jar…> (--id, --ver — если в jar их нет)');
  if (files.length > 1 && (id || version)) throw new Error('--id и --ver — только для одного jar');
  const out = [];
  for (const f of files) {
    const file = path.resolve(f);
    if (!fs.existsSync(file) || !/\.jar$/i.test(file)) throw new Error(`${f}: нет такого jar`);
    const info = modInfoOf(file);
    const addon = id ?? info?.id;
    const ver = version ?? info?.version;
    if (!addon || !ver) throw new Error(`${f}: в jar не нашлось modId и версии — укажите --id и --ver`);
    const sha256 = await sha256File(file);
    const size = fs.statSync(file).size;
    const { missing } = await api.post('/blobs/missing', { sha256: [sha256] });
    if (missing.length) await api.upload(file, sha256);
    const r = await api.post('/admin/addons', { addon, version: ver, file: path.basename(file), sha256, size });
    console.log(
      `${r.created ? green('+') : dim('=')} ${bold(`${addon} ${ver}`)} ${dim(`${path.basename(file)}, ${Math.round(size / 1024)} КБ`)}` +
        (r.created ? ' — новая версия (черновик): допишите ченджлог на сайте и выпустите' : dim(' — уже записана')),
    );
    out.push(r);
  }
  return out;
}

/** Версии аддонов: что есть на сервере, что стоит здесь, что закреплено */
export async function listAddons(api, profile, names = []) {
  const { addons } = await api.get('/site/addons');
  const state = profile ? loadState(profile) : {};
  const pins = state.addonPins ?? {};
  const pulled = state.pulled?.addons ?? {};
  const want = names.map((n) => n.toLowerCase().replace(/[-_]/g, ''));
  for (const a of addons) {
    if (want.length && !want.includes(a.id.replace(/_/g, ''))) continue;
    const vs = sortVersions(a.versions ?? []);
    const here = pulled[a.id];
    const installed = here ? vs.find((v) => v.sha256 === here.sha256) : null;
    const latest = vs.find((v) => v.status === 'released');
    console.log(
      `${bold(a.name)} ${dim(a.id)}` +
        (installed ? ` — стоит ${installed.version}` : here ? ' — стоит неизвестная версия' : '') +
        (pins[a.id] ? yellow(` (закреплена ${pins[a.id]})`) : ''),
    );
    if (!vs.length) console.log(dim('    версий на сервере сборки нет — ставится последняя со страницы сайта'));
    for (const v of vs.slice(0, names.length ? Infinity : 5)) {
      const mark = installed?.version === v.version ? green('●') : ' ';
      const st =
        v.status === 'withdrawn'
          ? red(STATUS_LABEL[v.status])
          : v.status === 'draft'
            ? yellow(STATUS_LABEL[v.status])
            : STATUS_LABEL[v.status];
      console.log(`  ${mark} ${v.version.padEnd(8)} ${dim(v.date)} ${st}${latest === v ? dim(' · последняя') : ''}`);
    }
    if (!names.length && vs.length > 5) console.log(dim(`    … ещё ${vs.length - 5} (tfc addons ${a.id})`));
    if (installed && latest && compareVersions(installed.version, latest.version) < 0 && !pins[a.id])
      console.log(dim(`    есть новее — tfc pull addons`));
  }
  console.log(dim('\nПоставить версию: tfc pull addons <мод>@<версия>; вернуть последнюю — <мод>@latest'));
}
