/**
 * `tfc pull`, часть «сайт» — контент сайта в папку игры (снимок сборки — plan.mjs и sync.mjs, вместе — cli/tfc.mjs): неподтверждённые датапаки → мир, подтверждённые ZIP → `kubejs/data/` сборки,
 * скрипты KubeJS «Ставить на сервер» → `kubejs/server_scripts/<fileName>`, схемы библиотеки → `schematics/`
 * (и на сервере — копии игроков в `schematics/uploaded/<ник>/`, uploadedCopies).
 * Берёт с сервера сборки (раздел /site), сайт закрыт App Check. Аддоны сборки → `mods/` — с сервера сборки
 * (/site/addons: версии из Firestore addonVersions, jar — блобы; `<мод>@<версия>` ставит и закрепляет версию в
 * state.addonPins, `@beta` подписывает на беты, `@latest` снимает), без ключа — со статики сайта (/addons/index.json, только последние): старый
 * jar того же мода и файлы, которые аддон заменяет (`replaces`), убираются с копией. Файлы собираются теми же модулями, что и
 * на сайте (packages/core/src/datapackFiles.ts, schematicFile.ts) — esbuild кладёт их в один файл программы.
 *
 * Что поставлено — `.tfc/state.json`, поле `pulled`: { вид: { id: { path, sha256, name } } }, path — как в
 * снимке (`world/…` для мира). Без имён — ставим отмеченные и убираем то, что ставили раньше и с чего сняли
 * отметку (только своё и только неизменённое). С именами — ставим названные, остальное не трогаем.
 * Старое уходит в ту же копию, что и файлы сборки (beginBackup в sync.mjs), `tfc undo` отменяет весь pull.
 *
 * Сайт и сборка не спорят за файл (siteOwned): у аддонов главный сайт — jar другой версии того же аддона и файлы
 * из `replaces` из сборки не ставятся; у датапаков тоже главный сайт — `tfc-plans-<id>.zip` и копия под именем,
 * которое даёт кнопка «Скачать» на сайте (zipName), из сборки не ставятся, а ручная копия рядом с поставленной
 * убирается (две версии одного датапака в мире спорили бы); `tfc publish` их в сборку не заливает
 * (siteDatapackPaths). У скриптов главная сборка — путь, который есть в снимке, сайт не трогает.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  deploymentsOf,
  inspectDatapack,
  isPackDatapackPath,
  PACK_DATAPACK_RE,
  packDatapackPath,
  worldDatapackPath,
} from '@tfc/pack-server/datapacks';
import { strToU8, zipSync } from 'fflate';
import { datapackFiles, datapackInstallMode, zipName } from '@tfc/core/datapackFiles';
import { schematicFromLibrary } from '@tfc/core/schematicFile';
import { inspectSchematic } from '@tfc/pack-server/schematic-nbt';
import {
  BETA_CHANNEL,
  compareVersions,
  isPrerelease,
  latestBeta,
  latestReleased,
  sortVersions,
} from '@tfc/core/addonVersions';
import { modIdsOf } from './jarid.mjs';
import { loadState, saveState } from './plan.mjs';
import { localPath, stateDir } from './scan.mjs';
import { assertNotLocked, toBackup } from './sync.mjs';
import { SITE } from './update.mjs';

export const PULL_KINDS = ['datapacks', 'kubejs', 'schematics', 'addons'];

/** Сайт со статикой аддонов; TFC_SITE — проверить на dev-сервере или копии */
const site = () => (process.env.TFC_SITE || SITE).replace(/\/+$/, '');

async function siteFetch(url) {
  let res;
  try {
    res = await fetch(site() + url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    throw new Error(`сайт ${site()} недоступен: ${e.cause?.code ?? e.cause?.message ?? e.message}`);
  }
  if (!res.ok) throw new Error(`сайт ответил ${res.status} на ${url}`);
  return res;
}

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fileSha = (file) => (fs.existsSync(file) ? sha(fs.readFileSync(file)) : null);
const query = (names) => (names.length ? `?${names.map((n) => `name=${encodeURIComponent(n)}`).join('&')}` : '');

/** Имя файла схемы — по названию на сайте (как кнопка «скачать»), запрещённые в именах символы — «_» */
export function schematicFileName(entry) {
  const safe = String(entry.name ?? '')
    .replace(/\.nbt$/i, '')
    // oxlint-disable-next-line no-control-regex -- управляющие символы в имени файла, как на сайте
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .trim()
    .replace(/^\.+/, '');
  return `${safe || String(entry.fileName ?? 'schematic').replace(/\.nbt$/i, '') || 'schematic'}.nbt`;
}

/** zip датапака: те же файлы, что на сайте; метка времени — дата правки, чтобы одинаковый датапак давал одинаковый zip */
export function datapackZip(pack) {
  const files = {};
  for (const [p, text] of Object.entries(datapackFiles(pack))) files[p] = strToU8(text);
  return zipSync(files, { level: 6, mtime: new Date(Math.max(pack.updatedAt || 0, Date.UTC(1990, 0, 1))) });
}

const KUBEJS_NAME_RE = /^[a-z0-9_][a-z0-9_.-]{0,79}\.js$/;

/** Куда tfc pull ставит датапак сайта (в мир или в kubejs/data/ сборки по installTarget) */
const SITE_DATAPACK_RE = /^world\/datapacks\/tfc-plans-[^/]+\.zip$/;
const isPackTarget = (d) => datapackInstallMode(d) === 'pack' || d.installTarget === 'pack';
const datapackPath = (d) => (isPackTarget(d) ? packDatapackPath(d.id) : worldDatapackPath(d.id));
/** Как датапак называется, если его скачали с сайта кнопкой «Скачать» и положили в мир руками */
const manualDatapackPath = (d) => `world/datapacks/${zipName(d)}`;

/**
 * Датапаки сайта в папке мира или в kubejs/data/ — их раздаёт сайт (tfc pull), в сборку при tfc publish их не
 * заливаем (кроме подтверждённых в снимке): иначе в мире у игроков окажется по две копии, а правка на сайте не
 * дойдёт (копия из снимка главнее). Это поставленное tfc pull (`tfc-plans-*.zip`, state.pulled) и ручные копии
 * под именем со страницы. Возвращает (путь) → название датапака или null.
 */
export async function siteDatapackPaths(api, profile) {
  const names = new Map();
  for (const r of Object.values(loadState(profile).pulled?.datapacks ?? {})) names.set(r.path, r.name);
  try {
    const { items } = await api.get('/site/datapacks?all=true');
    for (const d of items) {
      names.set(worldDatapackPath(d.id), d.name);
      names.set(packDatapackPath(d.id), d.name);
      names.set(manualDatapackPath(d), d.name);
    }
  } catch {
    // список с сайта не получили — узнаём только по имени tfc-plans-* и по тому, что ставил pull
  }
  return (p) =>
    names.get(p) ?? (SITE_DATAPACK_RE.test(p) ? p.slice(16) : PACK_DATAPACK_RE.test(p) ? p.slice(12) : null);
}

/**
 * Что хотим поставить: [{ id, name, path, bytes() }]; path — как в снимке.
 * unknown — названные, которых на сайте нет; all — для подсказки.
 */
async function wanted(api, kind, names, profile, staging) {
  if (kind === 'addons') return wantedAddons(api, names, profile, staging);
  if (kind === 'datapacks') {
    const r = await api.get(`/site/datapacks${query(names)}${names.length ? '&' : '?'}v=2`);
    // Датапак, который подтверждает staging-обновление, приходит файлом обновления в kubejs/data, не копией в мир
    if (staging && !names.length) r.items = r.items.filter((d) => !staging.datapackIds.has(d.id));
    return {
      ...r,
      items: [
        ...r.items.map((d) => ({
          id: d.id,
          name: d.name,
          path: datapackPath(d),
          manual: manualDatapackPath(d),
          bytes: async () => datapackZip(d),
        })),
        ...(r.snapshotItems ?? []).map((d) => ({
          id: d.id,
          name: d.name,
          path: d.sourcePath,
          expectedSha: d.sha256,
          bytes: async () => api.bytes(`/blobs/${d.sha256}`),
        })),
        ...(r.deployed ?? [])
          // Заменённый staging-обновлением: новый ZIP ставит план снимка, старый с сервера его бы затёр
          .filter((d) => !staging?.datapackIds.has(d.id))
          .filter(
            (d) =>
              !names.length ||
              names.some(
                (n) => n === d.id || n.toLowerCase() === d.name.toLowerCase() || n === d.path.split('/').at(-1),
              ),
          )
          .map((d) => ({
            id: d.id,
            name: d.name,
            path: d.path,
            deployment: d,
            expectedSha: d.sha256,
            bytes: async () => api.bytes(`/blobs/${d.sha256}`),
          })),
      ],
      notes: (r.omitted ?? []).map((d) => `«${d.name}» уже включён в сборку — используется подтверждённая версия`),
    };
  }
  if (kind === 'kubejs') {
    const r = await api.get(`/site/kubejs${query(names)}`);
    return {
      ...r,
      items: r.items
        .filter((s) => KUBEJS_NAME_RE.test(s.fileName ?? '') && typeof s.text === 'string')
        .map((s) => ({
          id: s.id,
          name: s.fileName,
          path: `kubejs/server_scripts/${s.fileName}`,
          bytes: async () => Buffer.from(s.text, 'utf8'),
        })),
    };
  }
  return schematicTargets(api, profile, names);
}

export async function schematicTargets(api, profile, names = []) {
  // Схемы: «Ставить» у них нет — без имён берём всю библиотеку
  const { items: list } = await api.get('/site/schematics');
  const want = names.map((n) => n.trim().toLowerCase()).filter(Boolean);
  const unknown = names.filter(
    (n) =>
      !list.some((s) => s.id === n || [s.name, schematicFileName(s)].some((x) => x?.toLowerCase() === n.toLowerCase())),
  );
  const chosen = want.length
    ? list.filter(
        (s) =>
          names.includes(s.id) ||
          [s.name, schematicFileName(s)].some((x) => want.includes(String(x ?? '').toLowerCase())),
      )
    : list;
  // Одинаковые названия — второй и дальше с кусочком id, чтобы не затирали друг друга
  const used = new Set();
  const cacheDir = path.join(stateDir(profile), 'site-files');
  const items = list
    .filter((s) => s.fileId)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => {
      let file = schematicFileName(s);
      if (used.has(file.toLowerCase())) file = file.replace(/\.nbt$/, `-${s.id.slice(0, 6)}.nbt`);
      if (used.has(file.toLowerCase())) file = file.replace(/\.nbt$/, `-${s.id}.nbt`);
      while (used.has(file.toLowerCase())) file = file.replace(/\.nbt$/, '-copy.nbt');
      used.add(file.toLowerCase());
      let memo; // один раз на схему: её же сверяем с копиями игроков на сервере
      return {
        id: s.id,
        name: s.name,
        path: `schematics/${file}`,
        bytes: () => (memo ??= build()),
        sourceBytes: source,
      };
      async function source() {
        const src = path.join(cacheDir, s.fileId);
        if (!fs.existsSync(src)) {
          fs.mkdirSync(cacheDir, { recursive: true });
          fs.writeFileSync(`${src}.part`, await api.bytes(`/site/files/${encodeURIComponent(s.fileId)}`));
          fs.renameSync(`${src}.part`, src);
        }
        return new Uint8Array(fs.readFileSync(src));
      }
      async function build() {
        return schematicFromLibrary(await source(), { ...s, replace: s.replace ?? [] });
      }
    })
    .filter((s) => chosen.some((x) => x.id === s.id));
  return { items, unknown, all: list.map((s) => ({ id: s.id, name: s.name })) };
}

/** Имя аддона из командной строки: id, имя jar с версией и без; «-», «_» и регистр не важны */
export const addonKey = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/\.jar$/, '')
    .replace(/[-_\s]+/g, '');
/** Имя jar без версии: ee-extras-2.0.1.jar → ee-extras */
export const jarBase = (file) => String(file ?? '').replace(/-\d[\w.+-]*\.jar$/i, '');

/** Аддон назван этим именем: id или имя jar любой его версии (с версией в имени и без) */
export const addonMatches = (a, n) =>
  [a.id, ...(a.versions ?? []).map((v) => v.file), ...(a.versions ?? []).map((v) => jarBase(v.file))].some(
    (x) => addonKey(x) === addonKey(n),
  );

/** jar в mods/ — какая-то версия этого аддона (по имени файла, и неизвестной версии тоже) */
export const isAddonJar = (a, file) => addonMatches(a, file) || addonMatches(a, jarBase(file));

/** Имя из командной строки → { name, version }: ee_extras@2.3.1, rw-host-fix@latest, ee_extras@beta */
export function splitAddonName(n) {
  const i = String(n).lastIndexOf('@');
  return i > 0 ? { name: n.slice(0, i), version: n.slice(i + 1) || null } : { name: n, version: null };
}

/**
 * Версия аддона для этой папки: названная (`@2.3.1`; `@latest` — снять закрепление), канал бет (`@beta`, в
 * state.addonPins — 'beta': свежайшая выпущенная бета или релиз, если он новее), закреплённая раньше версия или
 * последняя выпущенная не бета. Черновики и отозванные — только названные явно. → { v, pin, note }
 */
export function pickAddonVersion(a, asked, pinned) {
  const vs = a.versions ?? [];
  const latest = latestReleased(vs);
  if (asked === BETA_CHANNEL || (!asked && pinned === BETA_CHANNEL)) {
    const v = latestBeta(vs);
    const note = asked
      ? `подписываю на беты: ${v ? `ставлю ${v.version}` : 'выпущенных версий нет'} (вернуться к выпущенным — ${a.id}@latest)`
      : v && isPrerelease(v.version)
        ? `бета ${v.version}${latest ? `, выпущенная — ${latest.version}` : ''}`
        : null;
    return { v, pin: BETA_CHANNEL, note };
  }
  if (asked && asked !== 'latest') {
    const v = vs.find((x) => compareVersions(x.version, asked) === 0);
    if (!v)
      throw new Error(
        `у ${a.id} нет версии ${asked} на сервере сборки; есть: ${
          sortVersions(vs)
            .map((x) => x.version)
            .join(', ') || 'ни одной'
        }`,
      );
    const warn =
      v.status === 'withdrawn'
        ? ' — отозвана, ставлю по вашему слову'
        : v.status === 'draft'
          ? ' — черновик'
          : isPrerelease(v.version)
            ? ' — бета'
            : '';
    return { v, pin: v.version, note: `закрепляю ${v.version}${warn} (вернуть последнюю — ${a.id}@latest)` };
  }
  if (asked === 'latest')
    return {
      v: latest,
      pin: null,
      note: pinned === BETA_CHANNEL ? 'отписываю от бет' : pinned ? `снимаю закрепление ${pinned}` : null,
    };
  if (pinned) {
    const v = vs.find((x) => compareVersions(x.version, pinned) === 0);
    if (v)
      return {
        v,
        pin: pinned,
        note: `закреплена ${pinned}${v.status === 'withdrawn' ? ' (отозвана!)' : ''}${latest && latest.version !== pinned ? `, последняя — ${latest.version}` : ''}`,
      };
    return { v: latest, pin: null, note: `закреплённой ${pinned} на сервере нет — ставлю последнюю` };
  }
  return { v: latest, pin: undefined, note: null };
}

/**
 * Аддоны: без имён — все, что ставятся на эту сторону (клиент/сервер), с именами — названные (можно с @версией).
 * С ключом список и jar — с сервера сборки (/site/addons: все версии, откат, закрепление), без ключа — со статики
 * сайта (/addons/index.json: только последние версии). manual-аддон без имён — только если уже поставлен: обновляем,
 * не убираем. В статике таких нет: по ней запись поставленного сохраняем (keepManual).
 */
async function wantedAddons(api, names, profile, staging) {
  const side = profile.side ?? 'client';
  const asked = names.map(splitAddonName);
  const state = loadState(profile);
  const pins = state.addonPins ?? {};
  let list = null;
  let serverDown = false;
  if (api) {
    try {
      list = (await api.get('/site/addons?v=2&beta=1')).addons;
    } catch (e) {
      // старый сервер сборки без /site/addons — как раньше, со статики сайта; 503 — у него нет карточек аддонов
      if (e.status !== 404 && e.status !== 503) throw e;
      serverDown = e.status === 503;
    }
    // Старый сервер без карточек отвечает пустым списком — это сбой, а не «все аддоны убрали с сайта»
    if (list && !list.length) {
      list = null;
      serverDown = true;
    }
  }
  const index = await (await siteFetch('/addons/index.json')).json();
  const latestOnSite = (index.addons ?? []).filter(
    (a) => /^[\w.+-]+\.jar$/.test(a.file ?? '') && /^[0-9a-f]{64}$/.test(a.sha256),
  );
  // Аддон без версий на сервере сборки (ещё не перенесли) — последняя версия со статики сайта
  const all = list
    ? list.map((a) => {
        if (a.versions?.length) return a;
        const s = latestOnSite.find((x) => x.id === a.id);
        return s
          ? {
              ...a,
              versions: [
                { version: s.version, status: 'released', file: s.file, sha256: s.sha256, size: s.size, site: true },
              ],
            }
          : a;
      })
    : latestOnSite.map((s) => ({
        ...s,
        versions: [
          { version: s.version, status: 'released', file: s.file, sha256: s.sha256, size: s.size, site: true },
        ],
      }));
  // Ни с сервера, ни с сайта: по такому списку план снял бы все поставленные аддоны
  if (!all.length)
    throw new Error('список аддонов пуст и на сервере сборки, и на сайте — аддоны не трогаю, сообщите хосту');
  if (!api && asked.some((x) => x.version && x.version !== 'latest'))
    throw new Error('другие версии аддонов раздаёт сервер сборки — нужен ключ игрока (tfc login <ключ>)');
  const match = addonMatches;
  const chosen = asked.length
    ? all.filter((a) => asked.some((x) => match(a, x.name)))
    : all.filter((a) => (a.manual ? state.pulled?.addons?.[a.id] : a.side === 'both' || a.side === side));
  const cacheDir = path.join(stateDir(profile), 'site-files');
  const newPins = {};
  const items = [];
  const notes = serverDown ? ['сервер сборки не отдал список аддонов — беру последние версии с сайта'] : [];
  for (const a of chosen) {
    // jar этого мода даёт staging-обновление. Закрепление не трогаем: вернётся после отписки
    if (
      staging &&
      !asked.length &&
      (staging.jars.some((p) => isAddonJar(a, path.posix.basename(p))) ||
        (a.versions ?? []).some((v) => staging.removed.has(`mods/${v.file}`)))
    ) {
      notes.push(
        `${a.id}: версию даёт staging-обновление${pins[a.id] ? `, закреплённая ${pins[a.id]} вернётся после отписки` : ''}`,
      );
      continue;
    }
    const ask = asked.find((x) => match(a, x.name))?.version ?? null;
    // На сайте только последние версии: закрепления не применяем и не снимаем — вернутся со следующим pull
    const { v, pin, note } = pickAddonVersion(a, ask, serverDown ? undefined : pins[a.id]);
    if (pin !== undefined && !serverDown) newPins[a.id] = pin;
    if (note) notes.push(`${a.id}: ${note}`);
    if (!v) {
      notes.push(`${a.id}: выпущенных версий нет — пропускаю`);
      continue;
    }
    const jar = path.join(cacheDir, `${v.sha256}.jar`);
    items.push({
      id: a.id,
      name: `${a.name} ${v.version}`,
      manual: a.manual === true,
      version: v.version,
      path: `mods/${v.file}`,
      note: a.needs,
      replaces: Array.isArray(a.replaces) ? a.replaces : [],
      jar,
      bytes: async () => {
        if (fileSha(jar) !== v.sha256) {
          fs.mkdirSync(cacheDir, { recursive: true });
          if (api && !v.site) await api.download(v.sha256, jar);
          else {
            const bytes = new Uint8Array(await (await siteFetch(`/addons/${v.file}`)).arrayBuffer());
            if (sha(bytes) !== v.sha256)
              throw new Error(`${v.file} пришёл повреждённым (хеш не сошёлся) — запустите ещё раз`);
            fs.writeFileSync(`${jar}.part`, bytes);
            fs.renameSync(`${jar}.part`, jar);
          }
        }
        return fs.readFileSync(jar);
      },
    });
  }
  return {
    items,
    notes,
    pins: newPins,
    keepManual: !list,
    unknown: asked.filter((x) => !all.some((a) => match(a, x.name))).map((x) => x.name),
    all: all.map((a) => ({ id: a.id, name: `${a.id} ${sortVersions(a.versions ?? [])[0]?.version ?? ''}`.trim() })),
  };
}

/**
 * Что убрать при постановке аддонов: другие jar того же мода в mods/ (старая версия под другим именем — с двумя
 * игра не запустится) и файлы, которые аддон заменяет. Пути, которые ставим или уже убираем, — пропускаем.
 */
export function addonObsolete(profile, items, skip) {
  const out = new Map();
  const modsDir = path.join(profile.instance, 'mods');
  const jars = fs.existsSync(modsDir) ? fs.readdirSync(modsDir).filter((f) => /\.jar$/i.test(f)) : [];
  for (const it of items) {
    const ids = new Set(modIdsOf(it.jar));
    for (const f of jars) {
      const p = `mods/${f}`;
      if (skip.has(p) || out.has(p) || !ids.size) continue;
      const file = path.join(modsDir, f);
      const same = modIdsOf(file).filter((id) => ids.has(id));
      if (same.length) out.set(p, { id: p, name: `старая версия (${same.join(', ')})`, path: p, file });
    }
    for (const p of it.replaces) {
      const file = typeof p === 'string' && !p.startsWith('world/') ? localPath(profile, p) : null;
      if (!file || skip.has(p) || out.has(p) || !fs.existsSync(file)) continue;
      out.set(p, { id: p, name: `заменён аддоном ${it.id}`, path: p, file });
    }
  }
  return [...out.values()];
}

function worldZipPaths(profile) {
  if (!profile.world) return [];
  const dir = path.join(profile.world, 'datapacks');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.zip'))
    .map((e) => `world/datapacks/${e.name}`);
}

/**
 * План одного вида. Возвращает { add, update, same, conflict, remove, keptModified, skipped, unknown, all }:
 * элементы — { id, name, path, file, sha256, bytes }. staging — подписки профиля (staging.mjs): пути обновлений сайт
 * не трогает.
 */
export async function planPull(api, profile, kind, names = [], { force = false, staging = null } = {}) {
  const state = loadState(profile);
  const mine = state.pulled?.[kind] ?? {};
  const w = await wanted(api, kind, names, profile, staging);
  const staged = staging?.paths ?? new Set();
  if (!names.length) w.items = w.items.filter((it) => !staged.has(it.path));
  const plan = {
    kind,
    add: [],
    update: [],
    same: [],
    conflict: [],
    remove: [],
    keptModified: [],
    noWorld: [],
    obsolete: [],
  };
  const target = new Set();
  // На сервере схемы игрокам не нужны в schematics/: Create читает там только загруженные копии (ниже)
  const server = kind === 'schematics' && profile.side === 'server';
  for (const it of w.items) {
    if (server) continue;
    const file = localPath(profile, it.path);
    if (!file) {
      plan.noWorld.push(it);
      continue;
    }
    target.add(it.path);
    const bytes = await it.bytes();
    const item = { ...it, file, bytes, sha256: sha(bytes) };
    if (it.expectedSha && item.sha256 !== it.expectedSha)
      throw new Error(`«${it.name}»: повреждён ZIP — хеш не совпал`);
    const disk = fileSha(file);
    // Своё неизменённое — то, что ставил pull, или то, что поставил tfc sync из сборки
    const rec = mine[it.id];
    const ours =
      disk &&
      rec?.path === it.path &&
      rec.sha256 === disk &&
      (!it.path.startsWith('world/') || rec.world === profile.world);
    const fromSync =
      disk && state.files?.[it.path] === disk && (!it.path.startsWith('world/') || state.world === profile.world);
    if (!disk) plan.add.push(item);
    else if (disk === item.sha256) plan.same.push(item);
    else if (kind === 'schematics' && sameSchematic(file, bytes)) plan.same.push({ ...item, sha256: disk });
    // jar аддона руками не правят: другой файл под тем же именем — просто заменяем (с копией). Схему под именем
    // из библиотеки — тоже: почти всегда это её старая версия, а своё вернёт tfc undo
    else if (ours || fromSync || force || kind === 'addons' || kind === 'schematics') plan.update.push(item);
    else plan.conflict.push(item);
  }
  // Убрать: без имён — всё своё, чего больше нет среди отмеченных; переименованное — старый путь
  for (const [id, rec] of Object.entries(mine)) {
    const still = w.items.find((x) => x.id === id);
    if (still ? still.path === rec.path : names.length) continue;
    if (target.has(rec.path)) continue;
    // Сервер сборки не ответил — про manual не знаем, это не значит, что его убрали
    if (rec.manual && w.keepManual) continue;
    // По этому пути теперь файл обновления: запись сайта снимаем, файл не трогаем
    if (staged.has(rec.path)) {
      plan.remove.push({ id, name: rec.name, path: rec.path, gone: true });
      continue;
    }
    if (kind === 'datapacks' && still && plan.conflict.some((x) => x.id === id)) continue;
    const file = localPath(profile, rec.path);
    if (!file) continue;
    const disk = fileSha(file);
    const item = { id, name: rec.name, path: rec.path, file, sha256: rec.sha256 };
    if (rec.path.startsWith('world/') && rec.world && rec.world !== profile.world) continue;
    if (!disk) plan.remove.push({ ...item, gone: true });
    else if (disk === rec.sha256) plan.remove.push(item);
    else plan.keptModified.push(item);
  }
  if (kind === 'schematics') {
    const copies = await uploadedCopies(profile, w.items);
    plan.update.push(...copies.update);
    plan.same.push(...copies.same);
  }
  if (kind === 'datapacks') {
    for (const it of [...plan.add, ...plan.update, ...plan.same]) {
      const inPack = Boolean(it.deployment || isPackDatapackPath(it.path));
      const candidates = inPack
        ? new Set([
            worldDatapackPath(it.id),
            it.manual,
            ...(it.deployment?.worldPaths ?? []),
            ...worldZipPaths(profile),
          ])
        : new Set([it.manual]);
      for (const p of candidates) {
        if (!p || p === it.path || plan.obsolete.some((x) => x.path === p) || plan.remove.some((x) => x.path === p))
          continue;
        const file = localPath(profile, p);
        if (!file || !fs.existsSync(file)) continue;
        let same = false;
        try {
          same = inspectDatapack(fs.readFileSync(file)).contentHash === inspectDatapack(it.bytes).contentHash;
        } catch {
          /* Неизвестный ZIP оставляем. */
        }
        if (same) plan.obsolete.push({ id: p, name: `копия «${it.name}» в мире`, path: p, file });
        else if (p === it.manual || p === worldDatapackPath(it.id) || it.deployment?.worldPaths?.includes(p))
          plan.keptModified.push({ id: p, name: `изменённая копия «${it.name}»`, path: p, file });
      }
    }
  }
  if (kind === 'addons') {
    const skip = new Set([
      ...target,
      ...staged,
      ...plan.remove.map((x) => x.path),
      ...plan.keptModified.map((x) => x.path),
    ]);
    plan.obsolete = addonObsolete(profile, [...plan.add, ...plan.update, ...plan.same], skip);
    plan.skip = skip;
  }
  return {
    ...plan,
    unknown: w.unknown ?? [],
    all: w.all ?? [],
    notes: w.notes ?? [],
    pins: w.pins,
    snapshot: w.snapshot,
  };
}

/**
 * Копии схем игроков на сервере. Стол схем Create загружает файл игрока в `schematics/uploaded/<ник>/<файл>`
 * на сервере (у хоста — в его папке игры: мир открыт из его клиента), и пушка строит по этой копии, а не по файлу
 * у игрока. Игрок после `tfc pull` видит новую голограмму, а пушка строит старую. Поэтому pull на сервере
 * обновляет копии с тем же именем: почти всегда это старая версия схемы с сайта (с той, что стоит сейчас,
 * её не сравнить — старых версий сайт не хранит).
 * Хеши копий — в schematicCopies, отдельно от pulled: при удалении схемы с сайта файлы игроков не убираем.
 * Старое — в копию pull, `tfc undo` вернёт.
 */
async function uploadedCopies(profile, items) {
  const dir = path.join(profile.instance, 'schematics', 'uploaded');
  if (!fs.existsSync(dir)) return { update: [], same: [] };
  const players = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const out = { update: [], same: [] };
  for (const it of items) {
    const name = path.posix.basename(it.path);
    for (const nick of players) {
      const rel = `schematics/uploaded/${nick}/${name}`;
      const file = localPath(profile, rel);
      const disk = file && fileSha(file);
      if (!disk) continue;
      const bytes = await it.bytes();
      const sha256 = sha(bytes);
      const item = {
        id: `${it.id}@${nick}`,
        schematicId: it.id,
        name: `${it.name} — копия на сервере у ${nick}`,
        path: rel,
        file,
        bytes,
        sha256,
        copy: true,
      };
      if (disk === sha256) out.same.push(item);
      else if (sameSchematic(file, bytes)) out.same.push({ ...item, sha256: disk });
      else out.update.push(item);
    }
  }
  return out;
}

/** Та же схема в другом сжатии (gzip другой версии программы или игры) — по содержимому NBT */
function sameSchematic(file, bytes) {
  try {
    return inspectSchematic(fs.readFileSync(file)).contentHash === inspectSchematic(bytes).contentHash;
  } catch {
    return false;
  }
}

export const pullChanges = (p) =>
  p.add.length + p.update.length + p.conflict.length + p.remove.length + (p.obsolete?.length ?? 0);

const targets = (p) => [...p.add, ...p.update, ...p.same, ...p.conflict];

/**
 * Кто владеет путём, когда файл есть и в снимке, и на сайте. Меняет планы сайта (убирает из них пути снимка
 * у датапаков и скриптов) и возвращает { skip, overrides }: skip — пути, которые план снимка не трогает (их ставит
 * или убирает сайт), overrides — пути снимка, которые заменяют аддоны (запоминаются в state.addonOverrides, чтобы
 * `tfc pull kubejs` без аддонов не вернул скрипт, убранный аддоном). staged — файлы staging-обновлений: они главнее
 * сайта, их ставит план снимка.
 */
export function siteOwned(plans, snapshot, state, staged = new Set()) {
  const snapPaths = new Set((snapshot?.files ?? []).map((f) => f.path));
  for (const p of plans) {
    // У аддонов и датапаков главный сайт — их пути из снимка план сайта не уступает
    if (p.kind === 'addons' || p.kind === 'datapacks') continue;
    for (const k of ['add', 'update', 'same', 'conflict', 'remove', 'keptModified'])
      p[k] = p[k].filter((x) => !snapPaths.has(x.path));
  }
  const skip = new Set([
    ...deploymentsOf(snapshot).flatMap((d) => [worldDatapackPath(d.id), ...(d.worldPaths ?? [])]),
    ...Object.values(state.pulled?.datapacks ?? {}).map((r) => r.path),
  ]);
  for (const p of plans) for (const x of [...targets(p), ...p.remove, ...p.keptModified]) skip.add(x.path);
  // Датапаки сайта, залитые в сборку раньше (tfc-plans-*.zip и ручные копии), снимок не ставит и не убирает:
  // ими распоряжается сайт
  const dp = plans.find((p) => p.kind === 'datapacks');
  if (dp) {
    for (const x of dp.obsolete) skip.add(x.path);
    for (const x of targets(dp)) if (x.manual) skip.add(x.manual);
    for (const sp of snapPaths) if (SITE_DATAPACK_RE.test(sp)) skip.add(sp);
  }
  const addons = plans.find((p) => p.kind === 'addons');
  let overrides = state.addonOverrides ?? [];
  if (addons) {
    const mine = targets(addons);
    const bases = new Set(
      [...mine.map((x) => x.path), ...addons.remove.map((x) => x.path)].map((p) => addonKey(jarBase(p.slice(5)))),
    );
    const over = new Set();
    for (const f of snapshot?.files ?? [])
      if (f.kind === 'mod' && !skip.has(f.path) && !staged.has(f.path) && bases.has(addonKey(jarBase(f.path.slice(5)))))
        over.add(f.path);
    for (const x of mine) for (const r of x.replaces ?? []) if (snapPaths.has(r) && !staged.has(r)) over.add(r);
    for (const x of addons.obsolete) if (snapPaths.has(x.path)) over.add(x.path);
    // Заменённое раньше по id мода (имя jar не совпало) — пока стоят аддоны
    if (mine.length) for (const p of overrides) if (snapPaths.has(p) && !staged.has(p)) over.add(p);
    overrides = [...over];
  }
  for (const p of overrides) skip.add(p);
  for (const p of staged) skip.delete(p);
  return { skip, overrides };
}

/**
 * После снимка: сборка могла поставить jar того же мода, что аддон, под незнакомым именем — убрать и его
 * (и запомнить в overrides, чтобы в следующий раз сборка его не ставила).
 */
export function recheckAddons(profile, plans, overrides) {
  const addons = plans.find((p) => p.kind === 'addons');
  if (!addons) return;
  const skip = new Set([...addons.skip, ...addons.obsolete.map((x) => x.path)]);
  for (const x of addonObsolete(profile, targets(addons), skip)) {
    addons.obsolete.push(x);
    if (!overrides.includes(x.path)) overrides.push(x.path);
  }
}

/** Применить планы сайта (несколько видов за раз). backup — общая копия pull (beginBackup в sync.mjs) */
export function applyPull(profile, plans, backup, overrides) {
  const files = plans.flatMap((p) =>
    [...p.update, ...p.remove.filter((x) => !x.gone), ...(p.obsolete ?? [])].map((x) => x.file),
  );
  assertNotLocked(files);
  const state = loadState(profile);
  state.pulled ??= {};
  if (overrides) state.addonOverrides = overrides;
  // Закреплённые версии аддонов (tfc pull addons <мод>@<версия>); null — снять
  for (const p of plans)
    for (const [id, v] of Object.entries(p.pins ?? {})) {
      state.addonPins ??= {};
      if (v) state.addonPins[id] = v;
      else delete state.addonPins[id];
    }
  const manifest = backup.manifest;
  const keep = (x, list) => toBackup(backup, x.file, x.path, list);
  for (const p of plans) {
    const mine = (state.pulled[p.kind] ??= {});
    for (const x of p.update) keep(x, 'replaced');
    for (const x of [...p.add, ...p.update]) {
      fs.mkdirSync(path.dirname(x.file), { recursive: true });
      const tmp = path.join(path.dirname(x.file), `.tfc-${randomBytes(6).toString('hex')}.tmp`);
      try {
        fs.writeFileSync(tmp, x.bytes);
        fs.renameSync(tmp, x.file);
      } finally {
        fs.rmSync(tmp, { force: true });
      }
      if (p.add.includes(x)) manifest.added.push(x.path);
    }
    for (const x of p.remove) {
      if (!x.gone) keep(x, 'removed');
      delete mine[x.id];
    }
    for (const x of p.obsolete ?? []) {
      keep(x, 'removed');
      delete state.files?.[x.path];
    }
    for (const x of [...p.add, ...p.update, ...p.same]) {
      if (!x.copy)
        mine[x.id] = {
          path: x.path,
          sha256: x.sha256,
          name: x.name,
          world: profile.world ?? null,
          ...(x.manual === true ? { manual: true } : {}),
        };
      else {
        state.schematicCopies ??= {};
        state.schematicCopies[x.path] = { id: x.schematicId, sha256: x.sha256 };
      }
    }
    for (const x of p.conflict) {
      fs.writeFileSync(`${x.file}.tfc-new`, x.bytes);
      manifest.tfcNew.push(`${x.path}.tfc-new`);
    }
  }
  saveState(profile, state);
}
