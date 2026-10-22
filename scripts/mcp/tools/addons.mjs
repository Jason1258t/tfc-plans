/**
 * Инструменты MCP: аддоны сборки (tools/<мод>/) — список и проверка выпуска. Карточка — tools/<мод>/addon.json
 * (scripts/addons-index.mjs кладёт её jar и иконки на сайт при сборке), подробная страница — гайд Firestore
 * addon-<мод> (раздел addon), правится guide_get / guide_put. Здесь только чтение: файлы, jar аддона, один документ
 * гайда на аддон и /addons/index.json с сайта (что сейчас задеплоено).
 */
import fs from 'node:fs';
import path from 'node:path';
import { addonCards } from '../../addons-index.mjs';
import { items } from '../data.mjs';
import { guideDoc } from '../firestore.mjs';
import { dateOf, str } from '../fmt.mjs';
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
    const jar = fs.existsSync(path.join(c.dir, c.jar));
    const deployed = site?.get(c.id)?.version;
    const g = await guideDoc(guideId(c.id));
    const marks = [
      src && src !== c.version ? `в исходниках ${src}` : null,
      jar ? null : `нет ${c.jar}`,
      site ? (deployed === c.version ? null : `на сайте ${deployed ?? 'нет'}`) : null,
      g ? null : 'нет страницы',
      c.unlisted ? 'скрыт из списка' : null,
    ].filter(Boolean);
    out.push(
      `${c.id} ${c.version} — ${c.name} [${c.source}, ${c.side}, блоков ${c.blocks.length}]` +
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
  if (others.length) warns.push(`лишние jar в ${c.source}: ${others.join(', ')} (в git должен лежать один — текущий)`);
  let jar = null;
  if (!jars.includes(c.jar)) errors.push(`нет ${c.source}/${c.jar} — соберите release.sh / build.sh`);
  else {
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
    '— Firestore: 1 чтен.',
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
      'Release check of one addon: addon.json fields vs gradle.properties / build.sh and the jar (modId, version, items), stray jars, block ids, recipes (own items vs jar, others vs item library), icons in icons/, the site page (guide addon-<mod>: section, ::addon-block widgets, version mentioned, jar items not described), deployed version on the site. Edit the page with guide_get / guide_put.',
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
];
