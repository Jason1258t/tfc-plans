/**
 * Фоновая проверка печати схем библиотеки (dev #305): очередь и итоги лежат здесь, печатает исполнитель на машине
 * со стендом (scripts/print-worker.mjs на test1a) — сервер сборки стенд не поднимает (1 ядро, 2 ГБ).
 *
 * Схема ждёт проверки, если её итога нет или он снят не для того же файла (ключ: исходник + замены + форма) и не
 * для той же среды (текущий снимок + выпущенные аддоны). Пачка — до MAX_BATCH схем, одна за раз; исполнитель
 * отмечается (progress), молчит дольше BEAT_MS или дольше своего срока — пачка закрывается итогом «неясное»
 * с тем, что он успел сказать. Файл — <DATA_DIR>/print-checks.json, Firestore не читается (кроме кеша списка схем).
 */
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { HttpError, readJson, writeJsonAtomic } from './util.mjs';

const MAX_BATCH = 8;
/** Пачка не больше стольких блоков: крупные схемы идут по одной */
const MAX_BATCH_BLOCKS = 40_000;
const BEAT_MS = 20 * 60_000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const sha = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

/** Что влияет на печать: сам файл, замены и форма; описание и превью — нет */
export const schematicKey = (s) =>
  sha([s.fileId ?? null, s.sha256 ?? s.contentHash ?? null, s.replace ?? [], s.shape ?? null]);

/** 1.10.0 > 1.9.2 */
function cmpVersion(a, b) {
  const pa = String(a).split(/[.+-]/);
  const pb = String(b).split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '';
    const y = pb[i] ?? '';
    const d = /^\d+$/.test(x) && /^\d+$/.test(y) ? Number(x) - Number(y) : x.localeCompare(y);
    if (d) return d;
  }
  return 0;
}

/** Итог «неясное» для схем, проверка которых не дошла до конца */
function unclear(s, text, example = '') {
  const problem = { group: 4, code: 'not_finished', text, block: null, cells: 0, example: example.slice(-3000) };
  return {
    id: s.id,
    name: s.name,
    revision: s.revision ?? null,
    status: 'unclear',
    group: 4,
    sites: [{ mode: 'survival', group: 4, status: 'unclear', problems: [problem] }],
  };
}

export function openPrintChecks(dataDir, { store, site }) {
  const file = path.join(dataDir, 'print-checks.json');
  let state = null;
  let lock = Promise.resolve();

  async function load() {
    state ??= await readJson(file, { results: {}, previous: {}, batch: null, recheck: [] });
    return state;
  }
  const save = () => writeJsonAtomic(file, state);
  /** Одна правка за раз: claim и result не должны перемешаться */
  function locked(fn) {
    const next = lock.then(fn);
    lock = next.catch(() => {});
    return next;
  }

  /** Среда проверки: текущий снимок + последние выпущенные аддоны (как ставит tfc pull) */
  async function env() {
    const snapshot = (await store.getCurrent())?.id ?? null;
    const { addons } = await site.addons({ manual: true });
    const list = [];
    for (const a of addons) {
      if (a.manual) continue;
      const v = a.versions.filter((x) => x.status === 'released').sort((x, y) => cmpVersion(y.version, x.version))[0];
      if (v) list.push({ id: a.id, version: v.version, file: v.file, sha256: v.sha256, size: v.size });
    }
    list.sort((a, b) => a.id.localeCompare(b.id));
    return { snapshot, addons: list, key: sha([snapshot, list.map((a) => `${a.id}@${a.version}`)]) };
  }

  const fresh = (rec, s, e) => rec && rec.key === schematicKey(s) && rec.envKey === e.key;

  /** Очередь: новые и изменённые схемы, затем перепроверка под новую среду; внутри — от мелких к крупным */
  function queueOf(list, e) {
    const st = state;
    const running = new Set(st.batch?.ids ?? []);
    const forced = new Set(st.recheck);
    return list
      .filter((s) => !running.has(s.id) && (forced.has(s.id) || !fresh(st.results[s.id], s, e)))
      .map((s) => {
        const rec = st.results[s.id];
        const rank = forced.has(s.id) ? 0 : !rec || rec.key !== schematicKey(s) ? 1 : 2;
        return { s, rank };
      })
      .sort((a, b) => a.rank - b.rank || (a.s.blocks ?? 0) - (b.s.blocks ?? 0) || a.s.id.localeCompare(b.s.id))
      .map((x) => x.s);
  }

  /** Срок пачки: загрузка стенда + печать самой крупной схемы (площадки печатают одновременно) и повтор */
  const timeoutOf = (items) => Math.round(900 + Math.max(...items.map((s) => s.blocks ?? 0)) * 0.12);

  function store1(s, schem, claim, e, extra = {}) {
    const old = state.results[s.id];
    if (old && (old.key !== claim.key || old.envKey !== e.key)) state.previous[s.id] = old;
    state.results[s.id] = {
      key: claim.revision === (schem.revision ?? claim.revision) ? claim.key : null,
      revision: schem.revision ?? claim.revision,
      envKey: e.key,
      snapshot: e.snapshot,
      addons: e.addons.map((a) => `${a.id}@${a.version}`),
      checkedAt: new Date().toISOString(),
      batch: state.batch?.id ?? null,
      schematic: schem,
      ...extra,
    };
    state.recheck = state.recheck.filter((x) => x !== s.id);
  }

  /** Зависшая пачка → «неясное» с последним, что сказал исполнитель */
  function expire(now = Date.now()) {
    const b = state.batch;
    if (!b) return false;
    const silent = now - b.beatAt > BEAT_MS;
    const late = now - b.startedAt > (b.timeoutSec + 1800) * 1000;
    if (!silent && !late) return false;
    const why = silent
      ? `проверка не завершилась: исполнитель на стенде молчал ${Math.round((now - b.beatAt) / 60_000)} мин`
      : `проверка не завершилась за ${Math.round((now - b.startedAt) / 60_000)} мин`;
    const example = `этап: ${b.stage ?? '?'}${b.note ? `\n${b.note}` : ''}`;
    for (const id of b.ids) {
      const c = b.claims[id];
      store1({ id }, unclear({ id, name: c.name, revision: c.revision }, why, example), c, b.env);
    }
    console.log(`⏱ проверка печати: пачка ${b.id} закрыта как зависшая (${why})`);
    state.batch = null;
    return true;
  }

  /** Для сайта и агентов: состояние каждой схемы библиотеки */
  async function status() {
    const { items } = await site.schematics();
    const e = await env();
    return locked(async () => {
      await load();
      if (expire()) await save();
      const queue = queueOf(items, e);
      const pos = new Map(queue.map((s, i) => [s.id, i + 1]));
      const b = state.batch;
      const out = {};
      for (const s of items) {
        const rec = state.results[s.id];
        const cur = fresh(rec, s, e) && !state.recheck.includes(s.id);
        const running = b?.ids.includes(s.id);
        out[s.id] = {
          name: s.name,
          updatedAt: s.updatedAt ?? null,
          state: running ? 'running' : cur ? 'done' : 'queued',
          ...(pos.has(s.id) ? { position: pos.get(s.id) } : {}),
          current: cur ? rec : null,
          previous: cur ? null : (rec ?? state.previous[s.id] ?? null),
        };
      }
      return {
        env: { snapshot: e.snapshot, addons: e.addons.map((a) => `${a.id}@${a.version}`) },
        running: b
          ? {
              ids: b.ids,
              stage: b.stage ?? null,
              startedAt: b.startedAt,
              beatAt: b.beatAt,
              worker: b.worker,
              timeoutSec: b.timeoutSec,
            }
          : null,
        queued: queue.length,
        items: out,
      };
    });
  }

  /** Исполнитель берёт пачку: { batch: null } — делать нечего или занято */
  async function claim(body, who) {
    const { items } = await site.schematics();
    const e = await env();
    if (!e.snapshot) return { batch: null, reason: 'нет текущего снимка' };
    return locked(async () => {
      await load();
      expire();
      if (state.batch) {
        await save();
        return { batch: null, reason: `идёт пачка ${state.batch.id}` };
      }
      const queue = queueOf(items, e);
      if (!queue.length) {
        await save();
        return { batch: null, reason: 'всё проверено' };
      }
      const max = Math.min(MAX_BATCH, Math.max(1, Number(body?.max) || MAX_BATCH));
      const take = [];
      let blocks = 0;
      for (const s of queue) {
        if (take.length >= max) break;
        if (take.length && blocks + (s.blocks ?? 0) > MAX_BATCH_BLOCKS) continue;
        take.push(s);
        blocks += s.blocks ?? 0;
      }
      const now = Date.now();
      state.batch = {
        id: `${new Date(now).toISOString().slice(0, 19).replace(/\D/g, '')}-${randomBytes(2).toString('hex')}`,
        ids: take.map((s) => s.id),
        claims: Object.fromEntries(
          take.map((s) => [s.id, { key: schematicKey(s), revision: s.revision ?? null, name: s.name }]),
        ),
        env: e,
        worker: String(body?.worker ?? who.name).slice(0, 80),
        by: who.name,
        startedAt: now,
        beatAt: now,
        stage: 'claimed',
        note: '',
        timeoutSec: timeoutOf(take),
      };
      await save();
      console.log(`▶ проверка печати: пачка ${state.batch.id} (${take.length} схем) — ${state.batch.worker}`);
      return {
        batch: {
          id: state.batch.id,
          ids: state.batch.ids,
          items: take.map((s) => ({ id: s.id, name: s.name, revision: s.revision ?? null, blocks: s.blocks ?? 0 })),
          env: e,
          timeoutSec: state.batch.timeoutSec,
        },
      };
    });
  }

  function current(id) {
    if (!state.batch || state.batch.id !== id) throw new HttpError(409, `пачки ${id} нет (закрыта или зависла)`);
    return state.batch;
  }

  /** Отметка исполнителя: этап и строка о ходе */
  function progress(body) {
    return locked(async () => {
      await load();
      const b = current(String(body?.batch ?? ''));
      b.beatAt = Date.now();
      b.stage = String(body?.stage ?? b.stage).slice(0, 40);
      b.note = String(body?.note ?? '').slice(0, 2000);
      await save();
      return { ok: true };
    });
  }

  /**
   * Итог пачки: { batch, result } (result — printCheckReport) или { batch, error, log } — исполнитель не довёл
   * проверку (стенд упал, убит по сроку). Схемы пачки без итога — «неясное».
   */
  function finish(body) {
    return locked(async () => {
      await load();
      const b = current(String(body?.batch ?? ''));
      const got = new Map((body?.result?.schematics ?? []).map((s) => [s.id, s]));
      // Снимок, на котором печатали на деле (исполнитель мог не успеть подтянуть новый)
      const ran = body?.result?.snapshot;
      const e = ran && ran !== b.env.snapshot ? { ...b.env, snapshot: ran, key: `${b.env.key}:${ran}` } : b.env;
      const err = body?.error ? String(body.error).slice(0, 500) : '';
      const log = String(body?.log ?? '').slice(-4000);
      for (const id of b.ids) {
        const c = b.claims[id];
        const s = got.get(id);
        if (s) store1({ id }, s, c, e, { params: body.result.params ?? null });
        else
          store1(
            { id },
            unclear({ id, name: c.name, revision: c.revision }, err || 'исполнитель не прислал итог этой схемы', log),
            c,
            e,
          );
      }
      console.log(`■ проверка печати: пачка ${b.id} — ${err || `${got.size} итогов`}`);
      state.batch = null;
      await save();
      return { ok: true };
    });
  }

  /** Перепроверить: { ids } или { all: true } */
  function recheck(body) {
    return locked(async () => {
      await load();
      const ids = body?.all
        ? Object.keys(state.results)
        : (Array.isArray(body?.ids) ? body.ids : []).map(String).filter((x) => ID_RE.test(x));
      state.recheck = [...new Set([...state.recheck, ...ids])];
      await save();
      return { recheck: state.recheck };
    });
  }

  return { status, claim, progress, finish, recheck };
}
