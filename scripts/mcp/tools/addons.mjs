/**
 * Инструменты MCP: аддоны сборки (tools/<мод>/) — список и проверка выпуска. Карточка — tools/<мод>/addon.json
 * (scripts/addons-index.mjs кладёт её jar и иконки на сайт при сборке), подробная страница — гайд Firestore
 * addon-<мод> (раздел addon), правится guide_get / guide_put. Здесь только чтение: файлы, jar аддона, один документ
 * гайда на аддон и /addons/index.json с сайта (что сейчас задеплоено).
 * Версии аддона (Firestore addonVersions/{мод}@{версия}, src/lib/addonVersions.ts) — addon_versions,
 * addon_version_get, addon_version_put (ченджлог, статус, «что проверено»; jar заливает tfc admin addon upload).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { addonCards } from '../../addons-index.mjs';
import { items } from '../data.mjs';
import { api, FirestoreError, guideDoc } from '../firestore.mjs';
import { DOCS, fromValue, toValue } from '../../firestore-rest.mjs';
import {
  STATUS_LABEL,
  addonVersionId,
  compareVersions,
  latestReleased,
  sortVersions,
} from '../../../src/lib/addonVersions.ts';
import { dateOf, NICK, str } from '../fmt.mjs';
import { zipEntries, zipRead } from '../jars.mjs';
import { TOOLS_DIR } from '../resources.mjs';

const SITE = 'https://tfc-plans-fd2c.web.app';
const SIDES = ['both', 'client', 'server'];
const guideId = (id) => `addon-${id.replace(/_/g, '-')}`;

/** Корень репозитория: root — путь к git worktree (свежие карточки до слияния), иначе основная копия */
const rootOf = (a) => (a.root ? path.resolve(String(a.root)) : path.dirname(TOOLS_DIR));

function cardsOf(a) {
  const root = rootOf(a);
  if (!fs.existsSync(path.join(root, 'tools'))) throw new Error(`${root}: нет папки tools/`);
  return addonCards(root);
}

function findCard(a) {
  const q = String(a.id ?? '').trim();
  const list = cardsOf(a);
  const c = list.find(
    (x) => x.id === q || x.source === q || path.basename(x.source) === q || x.source.endsWith(`/${q}-mod`),
  );
  if (!c) throw new Error(`Аддона «${q}» нет. Есть: ${list.map((x) => x.id).join(', ')}`);
  return c;
}

/** Версия из исходников: mod_version в gradle.properties или VERSION= в build.sh */
function sourceVersion(dir) {
  const gp = path.join(dir, 'gradle.properties');
  if (fs.existsSync(gp)) return /^mod_version=(.+)$/m.exec(fs.readFileSync(gp, 'utf8'))?.[1].trim() ?? null;
  const bs = path.join(dir, 'build.sh');
  if (fs.existsSync(bs)) return /^VERSION=(.+)$/m.exec(fs.readFileSync(bs, 'utf8'))?.[1].trim() ?? null;
  return null;
}

const jarsIn = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.jar'));

/** Что в jar аддона: modId и версия из neoforge.mods.toml, предметы и блоки своего пространства имён с русскими именами */
function jarInfo(file, ns) {
  const toc = zipEntries(file);
  const text = (name) => {
    const e = toc.find((x) => x.name === name);
    return e ? zipRead(file, e).toString('utf8') : null;
  };
  const toml = text('META-INF/neoforge.mods.toml') ?? '';
  const modId = /^\s*modId\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? null;
  const version = /^\s*version\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? null;
  const ids = new Map(); // id → русское имя (или английское, или null)
  const lang = (l) => {
    try {
      return JSON.parse(text(`assets/${ns}/lang/${l}.json`) ?? '{}');
    } catch {
      return {};
    }
  };
  const ru = lang('ru_ru');
  const en = lang('en_us');
  const key = new RegExp(`^(?:block|item)\\.${ns}\\.([a-z0-9_/]+)$`);
  for (const k of new Set([...Object.keys(en), ...Object.keys(ru)])) {
    const m = key.exec(k);
    if (m) ids.set(`${ns}:${m[1]}`, ru[k] ?? en[k] ?? null);
  }
  const model = new RegExp(`^assets/${ns}/models/item/([a-z0-9_/]+)\\.json$`);
  for (const e of toc) {
    const m = model.exec(e.name);
    if (m && !ids.has(`${ns}:${m[1]}`)) ids.set(`${ns}:${m[1]}`, null);
  }
  return { modId, version, ids };
}

/** Что сейчас задеплоено: /addons/index.json сайта; null — сайт не ответил */
async function siteIndex() {
  try {
    const r = await fetch(`${SITE}/addons/index.json`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    return new Map(((await r.json()).addons ?? []).map((x) => [x.id, x]));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- addons_list

async function addonsList(a) {
  const cards = cardsOf(a);
  const site = await siteIndex();
  const out = [`Аддоны (${cards.length}) — карточки ${rootOf(a)}/tools/*/addon.json:`];
  for (const c of cards) {
    const src = sourceVersion(c.dir);
    const deployed = site?.get(c.id)?.version;
    const g = await guideDoc(guideId(c.id));
    const marks = [
      src && src !== c.version ? `в исходниках ${src}` : null,
      c.sha256 ? null : 'нет sha256 в карточке',
      site ? (deployed === c.version ? null : `на сайте ${deployed ?? 'нет'}`) : null,
      g ? null : 'нет страницы',
      c.unlisted ? 'скрыт из списка' : null,
    ].filter(Boolean);
    out.push(
      `${c.id} ${c.version} — ${c.name} [${c.source}, ${c.side}${c.hostOnly ? ', для хоста' : ''}, блоков ${c.blocks.length}]` +
        `; страница ${guideId(c.id)}${g ? ` (правил ${g.updatedBy} ${dateOf(g.updatedAt)})` : ''}` +
        (marks.length ? `\n    ⚠ ${marks.join('; ')}` : ''),
    );
  }
  if (!site) out.push(`(сайт ${SITE} не ответил — что задеплоено, не проверено)`);
  out.push(`— Firestore: ${cards.length} чтен. (по документу страницы на аддон)`);
  return out.join('\n');
}

// ---------------------------------------------------------------- addon_check

async function addonCheck(a) {
  const c = findCard(a);
  const errors = [];
  const warns = [];
  const info = [];
  const ns = c.id;

  // карточка
  for (const k of ['id', 'name', 'version', 'jar', 'summary', 'needs'])
    if (typeof c[k] !== 'string' || !c[k].trim()) errors.push(`addon.json: нет поля ${k}`);
  if (!SIDES.includes(c.side)) errors.push(`addon.json: side — ${SIDES.join(' | ')}, сейчас ${c.side}`);
  if (typeof c.order !== 'number') warns.push('addon.json: нет order (место в списке)');
  if (!Array.isArray(c.blocks)) errors.push('addon.json: blocks — массив (может быть пустым)');
  if (c.jar && c.version && !c.jar.includes(c.version)) warns.push(`имя jar ${c.jar} без версии ${c.version}`);

  // исходники и jar
  const src = sourceVersion(c.dir);
  if (src && src !== c.version) errors.push(`версия в исходниках ${src}, в addon.json ${c.version}`);
  const jars = jarsIn(c.dir);
  const others = jars.filter((f) => f !== c.jar);
  if (others.length) info.push(`другие jar в ${c.source}: ${others.join(', ')} (в git jar не хранятся — не мешают)`);
  let jar = null;
  let jarSha = null;
  if (!jars.includes(c.jar))
    info.push(`нет ${c.source}/${c.jar} — jar и предметы не проверены (соберите release.sh / build.sh перед выпуском)`);
  else {
    jarSha = createHash('sha256')
      .update(fs.readFileSync(path.join(c.dir, c.jar)))
      .digest('hex');
    if (c.sha256 !== jarSha) errors.push(`addon.json: sha256 ${c.sha256 ?? 'нет'}, у ${c.jar} — ${jarSha}`);
    jar = jarInfo(path.join(c.dir, c.jar), ns);
    if (jar.modId !== c.id) errors.push(`в jar modId ${jar.modId ?? '—'}, в addon.json id ${c.id}`);
    if (jar.version && jar.version !== c.version && !jar.version.includes('${'))
      errors.push(`в jar версия ${jar.version}, в addon.json ${c.version}`);
  }

  // блоки, рецепты, иконки
  const blocks = c.blocks ?? [];
  const cardIds = new Set(blocks.map((b) => b.id));
  const lib = items().byId;
  const iconsDir = path.join(c.dir, 'icons');
  const icons = new Set(fs.existsSync(iconsDir) ? fs.readdirSync(iconsDir).filter((f) => f.endsWith('.png')) : []);
  const used = new Set();
  const own = (id) => id.startsWith(`${ns}:`);
  for (const b of blocks) {
    if (jar && own(b.id) && !jar.ids.has(b.id)) errors.push(`блок ${b.id} есть в карточке, но не в jar`);
    if (!own(b.id) && !lib.has(b.id)) warns.push(`блок ${b.id} (чужой мод) не найден в библиотеке предметов сайта`);
    for (const f of [b.image, ...Object.values(b.recipe?.key ?? {}).map((k) => k.image)].filter(Boolean)) {
      used.add(f);
      if (!icons.has(f)) errors.push(`нет иконки ${c.source}/icons/${f} (${b.id})`);
    }
    if (b.recipe) {
      const { pattern, key } = b.recipe;
      if (!Array.isArray(pattern) || pattern.length > 3 || pattern.some((r) => r.length > 3))
        errors.push(`рецепт ${b.id}: pattern — до трёх строк по три символа`);
      for (const ch of new Set(pattern.join('').replace(/ /g, '')))
        if (!key[ch]) errors.push(`рецепт ${b.id}: символ «${ch}» без ключа`);
      for (const [ch, k] of Object.entries(key)) {
        if (own(k.item) ? jar && !jar.ids.has(k.item) : !lib.has(k.item))
          warns.push(`рецепт ${b.id}: «${ch}» = ${k.item} — нет ${own(k.item) ? 'в jar' : 'в библиотеке предметов'}`);
        if (own(k.item) && !k.image)
          warns.push(`рецепт ${b.id}: «${ch}» = ${k.item} — предмет аддона без image (иконки на сайте не будет)`);
      }
    }
  }
  const unusedIcons = [...icons].filter((f) => !used.has(f));
  if (unusedIcons.length) info.push(`иконки без ссылки из карточки: ${unusedIcons.join(', ')}`);

  // страница
  const g = await guideDoc(guideId(c.id));
  if (!g) warns.push(`нет страницы ${guideId(c.id)} — создайте guide_put (section: addon, baseRevision "new")`);
  else {
    if (g.section !== 'addon') errors.push(`страница ${guideId(c.id)}: section ${g.section}, нужен addon`);
    const body = g.body ?? '';
    const widgets = [...body.matchAll(/^::addon-block\s+id=(\S+)/gm)].map((m) => m[1]);
    for (const w of widgets)
      if (!cardIds.has(w)) errors.push(`на странице ::addon-block id=${w} — такого блока нет в карточке`);
    const missing = blocks.filter((b) => !widgets.includes(b.id)).map((b) => b.id);
    if (missing.length) warns.push(`блоки карточки без виджета на странице: ${missing.join(', ')}`);
    // 2.3.0 на странице пишут и как «2.3»
    if (!body.includes(c.version) && !body.includes(c.version.replace(/\.0$/, '')))
      warns.push(`версия ${c.version} на странице не упомянута — допишите, что нового и что проверено`);
    if (jar) {
      const lower = body.toLowerCase();
      const silent = [...jar.ids]
        .filter(
          ([id, name]) => !cardIds.has(id) && !lower.includes(id) && !(name && lower.includes(name.toLowerCase())),
        )
        .map(([id, name]) => (name ? `${id} «${name}»` : id));
      if (silent.length)
        info.push(
          `предметы jar без своей карточки и не названные на странице (проверьте, все ли описаны): ${silent.join(', ')}`,
        );
    }
  }

  // версия в addonVersions
  const rec = await versionDoc(c.id, c.version);
  if (!rec) errors.push(`нет записи версии ${c.version} — addon_version_put (baseRevision "new") с ченджлогом`);
  else {
    if (!rec.changelog?.trim()) errors.push(`у версии ${c.version} пустой ченджлог — addon_version_put changelog`);
    if (rec.status !== 'released')
      warns.push(
        `версия ${c.version} — ${STATUS_LABEL[rec.status] ?? rec.status}; выпустить — addon_version_put status=released`,
      );
    if (!rec.jar)
      errors.push(`у версии ${c.version} jar не залит — npm run tfc -- admin addon upload ${c.source}/${c.jar}`);
    else if (c.sha256 && rec.jar.sha256 !== c.sha256)
      errors.push(`у версии ${c.version} jar ${rec.jar.sha256.slice(0, 12)}…, в карточке ${c.sha256.slice(0, 12)}…`);
  }

  // сайт
  const site = await siteIndex();
  const dep = site?.get(c.id);
  if (!site) info.push(`сайт ${SITE} не ответил — что задеплоено, не проверено`);
  else if (!dep) info.push('на сайте аддона ещё нет — появится после деплоя (npm run deploy:site из main)');
  else if (dep.version !== c.version) info.push(`на сайте ${dep.version} — ${c.version} появится после деплоя`);
  else info.push(`на сайте ${dep.version} — задеплоено`);

  const list = (title, l) => (l.length ? [`${title}:`, ...l.map((x) => `  - ${x}`)] : []);
  return [
    `${c.id} ${c.version} — ${c.name} (${c.source}${a.root ? `, корень ${rootOf(a)}` : ''})`,
    `страница: ${guideId(c.id)}${g ? ` — правил ${g.updatedBy} ${dateOf(g.updatedAt)}, ревизия ${g.updateTime}` : ' — нет'}`,
    `блоков в карточке ${blocks.length}${jar ? `, предметов и блоков в jar ${jar.ids.size}` : ''}`,
    ...(errors.length || warns.length ? [] : ['Ошибок и предупреждений нет.']),
    ...list('Ошибки', errors),
    ...list('Предупреждения', warns),
    ...list('Сведения', info),
    '— Firestore: 2 чтен.',
  ].join('\n');
}

// ---------------------------------------------------------------- версии

const STATUSES = ['draft', 'released', 'withdrawn'];
const CHECKS = ['game', 'server', 'code', 'none'];
const fieldsOf = (d) => Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, fromValue(v)]));
const toFields = (data) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toValue(v)]));

/** Версии аддона: один запрос (runQuery addon == id) — по чтению на версию */
async function versionDocs(addon) {
  const r = await api(`${DOCS}:runQuery`, {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'addonVersions' }],
        where: { fieldFilter: { field: { fieldPath: 'addon' }, op: 'EQUAL', value: { stringValue: addon } } },
      },
    }),
  });
  return sortVersions(
    r.filter((x) => x.document).map((x) => ({ updateTime: x.document.updateTime, ...fieldsOf(x.document) })),
  );
}

async function versionDoc(addon, version) {
  try {
    const d = await api(`${DOCS}/addonVersions/${encodeURIComponent(addonVersionId(addon, version))}`);
    return { updateTime: d.updateTime, ...fieldsOf(d) };
  } catch (e) {
    if (e instanceof FirestoreError && e.status === 404) return null;
    throw e;
  }
}

const kb = (n) => `${Math.round(n / 1024)} КБ`;
const versionLine = (v) =>
  `${v.version} — ${v.date || 'без даты'}, ${STATUS_LABEL[v.status] ?? v.status}, проверено: ${v.checked}` +
  (v.jar ? `, jar ${v.jar.file} ${kb(v.jar.size)} (${v.jar.sha256.slice(0, 12)}…)` : ', jar не залит') +
  (v.changelog?.trim() ? '' : ', ⚠ без ченджлога');

async function addonVersions(a) {
  const c = findCard(a);
  const list = await versionDocs(c.id);
  if (!list.length)
    return `${c.id}: версий в addonVersions нет — заведите addon_version_put (baseRevision "new") или tfc admin addon upload\n— Firestore: 1 чтен.`;
  const latest = latestReleased(list);
  return [
    `${c.id} — версий ${list.length}; последняя выпущенная ${latest?.version ?? 'нет'}; в карточке ${c.version}`,
    ...list.map((v) => `- ${versionLine(v)}${a.full ? `\n  ${(v.changelog || '').replace(/\n/g, '\n  ')}` : ''}`),
    `— Firestore: ${list.length} чтен.`,
  ].join('\n');
}

async function addonVersionGet(a) {
  const c = findCard(a);
  const v = await versionDoc(c.id, String(a.version ?? ''));
  if (!v) return `${addonVersionId(c.id, a.version)}: нет такой версии\n— Firestore: 1 чтен.`;
  return [
    `${addonVersionId(c.id, v.version)} — ${versionLine(v)}`,
    `revision: ${v.updateTime}   ← для addon_version_put как baseRevision`,
    `правил ${v.updatedBy} ${dateOf(v.updatedAt)}`,
    v.checkedNote ? `проверка: ${v.checkedNote}` : null,
    '',
    v.changelog || '(ченджлога нет)',
    '— Firestore: 1 чтен.',
  ]
    .filter((x) => x !== null)
    .join('\n');
}

/**
 * Создать (baseRevision "new") или поправить версию. jar — путь к локальному jar: в запись идут имя, sha256 и размер
 * (сам файл на сервер сборки заливает tfc admin addon upload). Каждая правка — ещё и запись в revisions.
 */
async function addonVersionPut(a) {
  const c = findCard(a);
  const version = String(a.version ?? '').trim();
  if (!/^[0-9][\w.+-]{0,39}$/.test(version)) throw new Error('version — номер версии (2.3.3)');
  if (!a.baseRevision) throw new Error('baseRevision — revision из addon_version_get или "new" для новой версии');
  if (a.status && !STATUSES.includes(a.status)) throw new Error(`status — ${STATUSES.join(' | ')}`);
  if (a.checked && !CHECKS.includes(a.checked)) throw new Error(`checked — ${CHECKS.join(' | ')}`);
  if (a.date && !/^\d{4}-\d{2}-\d{2}$/.test(a.date)) throw new Error('date — ГГГГ-ММ-ДД');
  if (a.changelog && a.changelog.length > 20000) throw new Error('changelog — до 20 000 знаков');
  let jar;
  if (a.jar) {
    const file = path.resolve(String(a.jar));
    if (!fs.existsSync(file)) throw new Error(`нет файла ${file}`);
    const bytes = fs.readFileSync(file);
    const info = jarInfo(file, c.id);
    if (info.modId !== c.id) throw new Error(`в jar modId ${info.modId}, а аддон ${c.id}`);
    if (info.version && !info.version.includes('${') && compareVersions(info.version, version) !== 0)
      throw new Error(`в jar версия ${info.version}, а не ${version}`);
    jar = { file: path.basename(file), sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
  }
  const id = addonVersionId(c.id, version);
  const url = `${DOCS}/addonVersions/${encodeURIComponent(id)}`;
  const now = Date.now();
  const isNew = a.baseRevision === 'new';
  let cur = null;
  if (!isNew) {
    cur = await versionDoc(c.id, version);
    if (!cur) throw new Error(`${id}: нет такой версии — для новой baseRevision "new"`);
    if (cur.jar?.sha256 && jar && cur.jar.sha256 !== jar.sha256)
      throw new Error(`у ${id} уже другой jar (${cur.jar.sha256.slice(0, 12)}…) — поднимите номер версии`);
  }
  const edit = {
    changelog: a.changelog ?? cur?.changelog ?? '',
    status: a.status ?? cur?.status ?? 'draft',
    checked: a.checked ?? cur?.checked ?? 'none',
    checkedNote: a.checkedNote ?? cur?.checkedNote ?? '',
    date: a.date ?? cur?.date ?? new Date().toISOString().slice(0, 10),
  };
  const data = {
    addon: c.id,
    version,
    ...edit,
    jar: jar ?? cur?.jar ?? null,
    createdAt: cur?.createdAt ?? now,
    updatedAt: now,
    updatedBy: NICK,
  };
  const pre = isNew
    ? 'currentDocument.exists=false'
    : `currentDocument.updateTime=${encodeURIComponent(a.baseRevision)}`;
  let d;
  try {
    d = await api(`${url}?${pre}`, { method: 'PATCH', body: JSON.stringify({ fields: toFields(data) }) });
  } catch (e) {
    if (e instanceof FirestoreError && (e.status === 400 || e.status === 409))
      throw new Error(
        isNew
          ? `${id} уже есть — addon_version_get и правка с revision`
          : `${id} изменили после чтения — addon_version_get заново`,
      );
    throw e;
  }
  await api(`${url}/revisions`, {
    method: 'POST',
    body: JSON.stringify({ fields: toFields({ ...edit, updatedBy: NICK, at: now }) }),
  });
  return [
    `${isNew ? 'Создана' : 'Сохранена'} версия ${id}: ${versionLine(data)}`,
    `revision: ${d.updateTime}`,
    `на сайте: ${SITE}/addons/${c.id}`,
    `— Firestore: ${isNew ? 0 : 1} чтен.`,
  ].join('\n');
}

export const TOOLS = [
  {
    name: 'addons_list',
    description:
      'Pack addons (tools/<mod>/addon.json cards): version, folder, side, blocks; flags source/jar/site version mismatches and a missing site page (guide addon-<mod>). One Firestore read per addon.',
    inputSchema: {
      type: 'object',
      properties: { root: str('repo root to read cards from (a git worktree); default — main checkout') },
    },
    handler: addonsList,
  },
  {
    name: 'addon_check',
    description:
      'Release check of one addon: addon.json fields vs gradle.properties / build.sh and the jar (modId, version, items, sha256), the version record (addonVersions: changelog, status, jar uploaded), block ids, recipes (own items vs jar, others vs item library), icons in icons/, the site page (guide addon-<mod>: section, ::addon-block widgets, version mentioned, jar items not described), deployed version on the site. Edit the page with guide_get / guide_put.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('addon mod id (ee_extras) or folder (ee-extras-mod)'),
        root: str('repo root (a git worktree with the new release); default — main checkout'),
      },
      required: ['id'],
    },
    handler: addonCheck,
  },
  {
    name: 'addon_versions',
    description:
      'Versions of one addon (Firestore addonVersions): number, date, status (draft/released/withdrawn), checked, jar on the pack server, whether a changelog is written; full=true adds changelogs. One read per version.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('addon mod id (ee_extras) or folder'),
        full: { type: 'boolean', description: 'include changelog texts' },
        root: str('repo root (a git worktree); default — main checkout'),
      },
      required: ['id'],
    },
    handler: addonVersions,
  },
  {
    name: 'addon_version_get',
    description: 'One addon version with its changelog and revision (for addon_version_put).',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('addon mod id'),
        version: str('version, e.g. 2.3.3'),
        root: str('repo root (a git worktree); default — main checkout'),
      },
      required: ['id', 'version'],
    },
    handler: addonVersionGet,
  },
  {
    name: 'addon_version_put',
    description:
      'Create (baseRevision "new") or edit an addon version (**write to the shared database**, signed with the agent nick): changelog for players in Russian Markdown («что изменилось с прошлой версии»; prefix «Важно:» for what breaks or needs action), status draft|released|withdrawn, checked game|server|code|none, checkedNote, date YYYY-MM-DD, jar — local jar path (records file/sha256/size; upload the file itself with `npm run tfc -- admin addon upload <jar>`). Passed fields replace, others kept.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('addon mod id'),
        version: str('version, e.g. 2.3.3'),
        baseRevision: str('revision from addon_version_get, or "new"'),
        changelog: str('Markdown, Russian, for players'),
        status: { type: 'string', enum: STATUSES, description: 'draft / released / withdrawn' },
        checked: { type: 'string', enum: CHECKS, description: 'how it was checked' },
        checkedNote: str('how it was checked, what was not'),
        date: str('release date YYYY-MM-DD'),
        jar: str('local jar path of this version'),
        root: str('repo root (a git worktree); default — main checkout'),
      },
      required: ['id', 'version', 'baseRevision'],
    },
    handler: addonVersionPut,
  },
];
