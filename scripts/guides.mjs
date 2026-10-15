/**
 * Гайды справочника ↔ файлы Markdown. Источник правды — Firestore (guides), файлы — для заливки, резервной копии
 * и чтобы писать статьи не в браузере. Пишет через REST от имени `firebase login` (правила не действуют), каждое
 * сохранение — ещё и версия в guides/{id}/revisions, как с сайта.
 *
 *   npm run guides -- pull <папка> [--section power]   все гайды → <папка>/<id>.md
 *   npm run guides -- push <файл.md|папка> [...]        файлы → Firestore (id — имя файла)
 *
 * Файл: YAML-заголовок между «---» (section, title, summary, icon, group, order, checked, hidden), дальше — текст.
 * Подпись правки — TFC_NICK или git user.name.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { DOCS, deployer, toValue, token } from './firestore-rest.mjs';

const CHECKED = ['game', 'server', 'code', 'none'];

function fromValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(fromValue);
  if ('mapValue' in v)
    return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, fromValue(x)]));
  return null;
}

async function api(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', ...init.headers },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

function readGuide(file) {
  const src = fs.readFileSync(file, 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(src);
  if (!m) throw new Error(`${file}: нет заголовка ---`);
  const fm = parse(m[1]) ?? {};
  const id = path.basename(file, '.md');
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`${file}: имя файла — латиница, цифры и дефис (это id в адресе)`);
  if (!fm.title) throw new Error(`${file}: нет title`);
  const g = {
    section: fm.section ?? 'power',
    title: String(fm.title),
    summary: String(fm.summary ?? '').trim(),
    body: m[2].replace(/^\n+/, ''),
    icon: fm.icon ?? null,
    group: String(fm.group ?? ''),
    order: Number(fm.order ?? 100),
    checked: CHECKED.includes(fm.checked) ? fm.checked : 'none',
    hidden: Boolean(fm.hidden),
  };
  if (g.body.length > 200000) throw new Error(`${file}: текст больше 200 000 символов`);
  return { id, g };
}

async function push(files) {
  const nick = deployer('Claude').slice(0, 24);
  for (const file of files) {
    const { id, g } = readGuide(file);
    const now = Date.now();
    const url = `${DOCS}/guides/${id}`;
    let createdAt = now;
    try {
      const cur = await api(url);
      createdAt = fromValue(cur.fields.createdAt ?? { integerValue: now });
    } catch {
      // нового ещё нет
    }
    const fields = { ...g, updatedBy: nick, createdAt, updatedAt: now };
    await api(url, {
      method: 'PATCH',
      body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, toValue(v)])) }),
    });
    const rev = { title: g.title, summary: g.summary, body: g.body, updatedBy: nick, at: now };
    await api(`${url}/revisions`, {
      method: 'POST',
      body: JSON.stringify({ fields: Object.fromEntries(Object.entries(rev).map(([k, v]) => [k, toValue(v)])) }),
    });
    console.log(`✓ ${id} — ${g.title}`);
  }
}

async function pull(dir, section) {
  fs.mkdirSync(dir, { recursive: true });
  let pageToken = '';
  let n = 0;
  do {
    const r = await api(`${DOCS}/guides?pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`);
    for (const d of r.documents ?? []) {
      const f = Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, fromValue(v)]));
      if (section && f.section !== section) continue;
      const id = d.name.split('/').pop();
      const head = stringify(
        {
          section: f.section,
          title: f.title,
          summary: f.summary,
          icon: f.icon,
          group: f.group,
          order: f.order,
          checked: f.checked,
          hidden: f.hidden,
        },
        { lineWidth: 0 },
      );
      fs.writeFileSync(path.join(dir, `${id}.md`), `---\n${head}---\n${f.body}`);
      console.log(`↓ ${id} — ${f.title} (правил ${f.updatedBy})`);
      n++;
    }
    pageToken = r.nextPageToken ?? '';
  } while (pageToken);
  console.log(`Гайдов: ${n} → ${dir}`);
}

const [cmd, ...rest] = process.argv.slice(2);
const sIdx = rest.indexOf('--section');
const section = sIdx >= 0 ? rest.splice(sIdx, 2)[1] : null;
if (cmd === 'pull' && rest[0]) await pull(rest[0], section);
else if (cmd === 'push' && rest.length) {
  const files = rest.flatMap((p) =>
    fs.statSync(p).isDirectory()
      ? fs
          .readdirSync(p)
          .filter((f) => f.endsWith('.md'))
          .map((f) => path.join(p, f))
      : [p],
  );
  await push(files);
} else {
  console.log('npm run guides -- pull <папка> [--section power]\nnpm run guides -- push <файл.md|папка> [...]');
  process.exit(1);
}
