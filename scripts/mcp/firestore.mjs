/**
 * Firestore для MCP — REST от имени `firebase login` (scripts/firestore-rest.mjs). Конфиги — только чтение;
 * гайды — чтение и запись guide_put с проверкой ревизии. Читаем редко и с кешем: лимит бесплатного тарифа —
 * 50 тыс. чтений в сутки на всех.
 */
import { DOCS, fromValue, toValue, token } from '../firestore-rest.mjs';

let tok = null;
async function auth() {
  if (!tok || tok.until < Date.now()) tok = { value: await token(), until: Date.now() + 45 * 60_000 };
  return tok.value;
}

export class FirestoreError extends Error {
  constructor(status, body, msg) {
    super(msg);
    this.status = status;
    this.body = body;
  }
}

async function api(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${await auth()}`, 'Content-Type': 'application/json', ...init.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new FirestoreError(
      res.status,
      body,
      `${init.method ?? 'GET'} ${url.replace(DOCS, '')}: ${res.status} ${body}`,
    );
  }
  return res.json();
}

const fields = (d) => Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, fromValue(v)]));

async function listAll(collection, mask) {
  const out = [];
  let pageToken = '';
  const m = mask ? mask.map((f) => `&mask.fieldPaths=${f}`).join('') : '';
  do {
    const r = await api(`${DOCS}/${collection}?pageSize=300${m}${pageToken ? `&pageToken=${pageToken}` : ''}`);
    for (const d of r.documents ?? [])
      out.push({ id: d.name.split('/').pop(), updateTime: d.updateTime, ...fields(d) });
    pageToken = r.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

/** Кеш списка на ttl мс: повторные вопросы агента не тратят чтения */
function cached(ttl, load) {
  let c = null;
  const get = async () => {
    if (!c || c.until < Date.now()) c = { until: Date.now() + ttl, value: load() };
    try {
      return await c.value;
    } catch (e) {
      c = null;
      throw e;
    }
  };
  get.reset = () => (c = null);
  return get;
}

/** Все импортированные конфиги (config/{scope}__{путь}) — их немного, читаем целиком раз в 5 минут */
export const configDocs = cached(5 * 60_000, () => listAll('config'));

/** Гайды целиком (с текстом) — раз в минуту; guide_get читает статью заново */
export const guideDocs = cached(60_000, () => listAll('guides'));

export async function guideDoc(id) {
  try {
    const d = await api(`${DOCS}/guides/${id}`);
    return { id, updateTime: d.updateTime, ...fields(d) };
  } catch (e) {
    if (e instanceof FirestoreError && e.status === 404) return null;
    throw e;
  }
}

/**
 * Сохранение гайда, как scripts/guides.mjs push (документ + версия в revisions), но с условием Firestore:
 * документ не менялся с ревизии base (updateTime), а для нового — ещё не существует. Иначе — FirestoreError.
 */
export async function writeGuide(id, data, base) {
  const pre =
    base === 'new' ? 'currentDocument.exists=false' : `currentDocument.updateTime=${encodeURIComponent(base)}`;
  const url = `${DOCS}/guides/${id}`;
  const d = await api(`${url}?${pre}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toValue(v)])) }),
  });
  const rev = {
    title: data.title,
    summary: data.summary,
    body: data.body,
    updatedBy: data.updatedBy,
    at: data.updatedAt,
  };
  await api(`${url}/revisions`, {
    method: 'POST',
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(rev).map(([k, v]) => [k, toValue(v)])) }),
  });
  guideDocs.reset();
  return d.updateTime;
}
