/**
 * Версии аддонов на сервере сборки: `tfc admin addon upload <jar…>` — залить jar версии (блоб) и записать версию
 * на сайте (Firestore addonVersions, новая — черновик; ченджлог пишут на сайте или MCP addon_version_put);
 * `tfc addons list` — аддоны полными строками `мод@версия` (`--host-only` — только для хоста), `tfc addons <мод>` — его
 * версии, `tfc addons install <мод>@<версия>` — поставить (= `tfc pull addons`, в tfc.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { compareVersions, sortVersions, STATUS_LABEL } from '@tfc/core/addonVersions';
import { modInfoOf } from './jarid.mjs';
import { loadState } from './plan.mjs';
import { addonMatches } from './pull.mjs';
import { sha256File } from './scan.mjs';
import { bold, cyan, dim, green, red, yellow } from './ui.mjs';

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

/** Полная строка аддона — то, что принимают tfc addons install и tfc pull addons */
const full = (a, v) => `${a.id}@${v}`;

/** Список с сервера сборки + что стоит в этой папке и что закреплено */
async function addonsHere(api, profile) {
  const { addons } = await api.get('/site/addons');
  const state = profile ? loadState(profile) : {};
  const pins = state.addonPins ?? {};
  const pulled = state.pulled?.addons ?? {};
  return addons.map((a) => {
    const vs = sortVersions(a.versions ?? []);
    const here = pulled[a.id];
    return {
      a,
      vs,
      here,
      installed: here ? vs.find((v) => v.sha256 === here.sha256) : null,
      latest: vs.find((v) => v.status === 'released'),
      pin: pins[a.id],
    };
  });
}

/** Что стоит здесь: « — стоит 1.0.0 (закреплена 1.0.0)» */
const hereNote = ({ here, installed, pin }) =>
  (installed ? ` — стоит ${installed.version}` : here ? ' — стоит неизвестная версия' : '') +
  (pin ? yellow(` (закреплена ${pin})`) : '');

/** tfc addons list: по строке на аддон — полная строка последней версии, название, что стоит здесь */
export async function listAddons(api, profile, { hostOnly = false } = {}) {
  const list = (await addonsHere(api, profile)).filter((x) => !hostOnly || x.a.hostOnly);
  if (!list.length) return console.log(hostOnly ? 'Аддонов для хоста нет.' : 'Аддонов нет.');
  const str = ({ a, vs, latest }) => full(a, (latest ?? vs[0])?.version ?? 'latest');
  const width = Math.max(...list.map((x) => str(x).length));
  for (const x of list) {
    const { a, vs, installed, latest, pin } = x;
    const top = latest ?? vs[0];
    console.log(
      `${bold(str(x).padEnd(width))}  ${a.name}${a.hostOnly ? cyan(' [хосту]') : ''}${top && !latest ? yellow(` (${STATUS_LABEL[top.status]})`) : ''}${hereNote(x)}`,
    );
    if (installed && latest && compareVersions(installed.version, latest.version) < 0 && !pin)
      console.log(dim(`    есть новее — tfc addons install ${full(a, latest.version)}`));
  }
  console.log(dim('\nВерсии аддона: tfc addons <мод>; поставить: tfc addons install <мод>@<версия>'));
}

/** tfc addons <мод…>: все версии названных аддонов полными строками */
export async function showAddons(api, profile, names) {
  const list = await addonsHere(api, profile);
  const unknown = names.filter((n) => !list.some((x) => addonMatches(x.a, n)));
  if (unknown.length)
    throw new Error(
      `нет аддона «${unknown.join('», «')}» — список: tfc addons list (есть: ${list.map((x) => x.a.id).join(', ')})`,
    );
  for (const x of list.filter((x) => names.some((n) => addonMatches(x.a, n)))) {
    const { a, vs, installed, latest } = x;
    console.log(`${bold(a.name)} ${dim(a.id)}${a.hostOnly ? cyan(' [хосту]') : ''}${hereNote(x)}`);
    if (a.needs) console.log(dim(`  ${a.needs}`));
    const width = Math.max(0, ...vs.map((v) => full(a, v.version).length));
    if (!vs.length) console.log(dim('  версий на сервере сборки нет — ставится последняя со страницы сайта'));
    for (const v of vs) {
      const mark = installed?.version === v.version ? green('●') : ' ';
      const st =
        v.status === 'withdrawn'
          ? red(STATUS_LABEL[v.status])
          : v.status === 'draft'
            ? yellow(STATUS_LABEL[v.status])
            : STATUS_LABEL[v.status];
      console.log(
        `  ${mark} ${full(a, v.version).padEnd(width)} ${dim(v.date)} ${st}${latest === v ? dim(' · последняя') : ''}`,
      );
    }
  }
  console.log(dim('\nПоставить и закрепить: tfc addons install <мод>@<версия>; вернуть последнюю — <мод>@latest'));
}
