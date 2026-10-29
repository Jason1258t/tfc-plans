/** Список, проверенные ZIP в мире и подтверждение хостом одного/всех датапаков. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  datapackContentHash,
  deploymentsOf,
  inspectDatapack,
  isPackDatapackPath,
  packDatapackPath,
  worldDatapackPath,
} from '../../server/pack-server/lib/datapacks.mjs';
import { datapackFiles, zipName } from '../../src/lib/datapackFiles.ts';
import { confirm, dim, interactive } from './ui.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const short = (s) => s?.slice(0, 12) ?? '—';
const key = (s) => String(s ?? '').toLowerCase();

export function localDatapacks(profile) {
  const out = [];
  for (const [base, prefix] of [
    [profile.world && path.join(profile.world, 'datapacks'), 'world/datapacks'],
    [path.join(profile.instance, 'kubejs/data'), 'kubejs/data'],
  ]) {
    if (!base || !fs.existsSync(base) || fs.lstatSync(base).isSymbolicLink()) continue;
    for (const e of fs.readdirSync(base, { withFileTypes: true })) {
      if (!e.isFile() || !e.name.endsWith('.zip')) continue;
      const file = path.join(base, e.name);
      let info;
      let error;
      try {
        if (fs.statSync(file).size > 32 * 1024 ** 2) throw new Error('больше 32 МБ');
        const bytes = fs.readFileSync(file);
        info = { ...inspectDatapack(bytes), sha256: hash(bytes) };
      } catch (e) {
        error = e.message;
      }
      out.push({ file, path: `${prefix}/${e.name}`, info, error });
    }
  }
  return out;
}

async function catalog(api) {
  const [inventory, snapshot] = await Promise.all([api.get('/site/datapacks?all=true&v=2'), api.current()]);
  if (!Array.isArray(inventory.deployed))
    throw new Error('сервер ещё не поддерживает уровни датапаков — обновите сервер сборки');
  if (inventory.snapshot !== (snapshot?.id ?? null))
    throw new Error('сборка изменилась во время чтения — повторите команду');
  const items = inventory.items.map((d) => ({ ...d, contentHash: datapackContentHash(datapackFiles(d)) }));
  return { items: [...items, ...(inventory.snapshotItems ?? [])], snapshot, deployed: deploymentsOf(snapshot) };
}

function matches(d, query) {
  return [d.id, d.name, d.fileName, zipName(d), `tfc-plans-${d.id}.zip`].some((s) => s && key(s) === key(query));
}

function select(items, names) {
  if (!names.length || (names.length === 1 && names[0] === 'all')) return items;
  const selected = new Set();
  for (const n of names) {
    const found = items.filter((d) => matches(d, n));
    if (found.length !== 1)
      throw new Error(
        found.length ? `«${n}»: несколько пакетов — укажите id` : `нет датапака «${n}» — tfc datapacks list`,
      );
    selected.add(found[0]);
  }
  return [...selected];
}

export async function listDatapacks(api, profile, query = '', filesOnly = false) {
  const c = await catalog(api);
  const local = profile ? localDatapacks(profile) : [];
  if (!filesOnly) {
    console.log(`Датапаки сайта; снимок ${c.snapshot?.id ?? 'ещё не опубликован'}`);
    for (const d of c.items.filter((d) => key(`${d.id} ${d.name} ${zipName(d)}`).includes(key(query)))) {
      const deployed = c.deployed.find((p) => p.id === d.id);
      const world = local.filter((f) => f.path.startsWith('world/') && f.info?.contentHash === d.contentHash);
      const state = deployed
        ? `в сборке${deployed.contentHash !== d.contentHash ? '; на сайте новая непроверенная редакция' : ''}`
        : world.length
          ? 'установлен в мире'
          : d.install
            ? 'доступен для мира'
            : 'тестовый';
      console.log(
        `${d.id} — ${d.name} · ${state}${d.snapshotSource ? '; ZIP снимка без карточки сайта' : ''}${d.error ? `; ${d.error}` : ''}`,
      );
      console.log(
        dim(
          `  ${zipName(d)}; содержимое ${short(d.contentHash)}${deployed ? `; подтверждено ${short(deployed.contentHash)} (${deployed.confirmedBy})` : ''}`,
        ),
      );
    }
    for (const d of c.deployed.filter((d) => !c.items.some((s) => s.id === d.id)))
      console.log(`${d.id} — ${d.name} · в сборке; карточка сайта удалена`);
  }
  console.log('Файлы снимка: filename — название · место · sha256');
  for (const f of c.snapshot?.files.filter(
    (f) => (f.kind === 'world-datapack' || isPackDatapackPath(f.path)) && f.path.endsWith('.zip'),
  ) ?? []) {
    let d = c.deployed.find((d) => d.path === f.path);
    if (!d) {
      try {
        const content = inspectDatapack(await api.bytes(`/blobs/${f.sha256}`)).contentHash;
        d = c.items.find((d) => d.contentHash === content && d.contentHash);
      } catch {
        /* Повреждённый архив виден как неизвестный. */
      }
    }
    if (!key(`${f.path} ${d?.name ?? ''}`).includes(key(query))) continue;
    console.log(
      `${path.posix.basename(f.path)} — ${d ? `${d.name}${d.snapshotSource ? ' (нет карточки сайта)' : ''}` : 'неизвестный датапак'} · ${f.path} · ${short(f.sha256)}`,
    );
  }
  if (profile && !filesOnly) {
    console.log(`Локальные ZIP (${profile.world ? `мир: ${profile.world}` : 'мир не выбран'}):`);
    for (const f of local) {
      const d =
        c.items.find((d) => d.contentHash === f.info?.contentHash) ??
        c.deployed.find((d) => d.contentHash === f.info?.contentHash);
      if (!key(`${f.path} ${d?.name ?? ''}`).includes(key(query))) continue;
      console.log(
        `${f.path} — ${d?.name ?? 'неизвестный или изменённый датапак'} · ${short(f.info?.sha256)}${f.error ? ` (${f.error})` : ''}`,
      );
    }
  }
}

/** Имена разрешаем до pull: одинаковые названия не должны незаметно выбирать два разных датапака. */
export async function datapackIds(api, names) {
  const c = await catalog(api);
  return select(c.items, names).map((d) => d.id);
}

export async function confirmDatapacks(api, profile, names, { yes = false, dryRun = false, action = 'confirm' } = {}) {
  // Права проверяем даже при предпросмотре, до загрузки файлов.
  if ((await api.role()) !== 'admin') throw new Error('подтверждать датапаки может только хост (ключ администратора)');
  const c = await catalog(api);
  if (!c.snapshot) throw new Error('сначала опубликуйте снимок сборки');
  const all = !names.length || (names.length === 1 && names[0] === 'all');
  const local = localDatapacks(profile);
  let selected = select(action === 'confirm' ? c.items : c.deployed, names);
  const items = [];
  if (action === 'confirm') {
    if (!profile.world) throw new Error('выберите мир с проверенными датапаками: tfc init --world <мир>');
    if (!c.snapshot.files.some((f) => /^mods\/kubejs-neoforge-2101\./.test(f.path)))
      throw new Error('в снимке не найден KubeJS для 1.21.1; перенос не поддерживается');
    if (all) selected = selected.filter((d) => d.install && !c.deployed.some((p) => p.id === d.id));
    for (const d of selected) {
      if (d.error) {
        if (all) {
          console.log(`Пропускаю ${d.fileName}: ${d.error}`);
          continue;
        }
        throw new Error(`${d.fileName}: ${d.error}`);
      }
      if (c.deployed.some((p) => p.id === d.id)) {
        console.log(`«${d.name}» уже в сборке. Для проверки новой версии: tfc datapacks unconfirm ${d.id}`);
        continue;
      }
      const candidates = local.filter((f) => f.path.startsWith('world/') && f.info?.contentHash === d.contentHash);
      const canonical = local.find((f) => f.path === worldDatapackPath(d.id));
      if (canonical && canonical.info?.contentHash !== d.contentHash)
        throw new Error(`«${d.name}»: копия мира отличается от сайта — сначала сравните и проверьте нужную версию`);
      const source = canonical ?? candidates[0];
      if (!source) {
        if (all) {
          console.log(`Пропускаю «${d.name}»: совпадающей проверенной копии в мире нет.`);
          continue;
        }
        throw new Error(`«${d.name}»: в мире нет ZIP с содержимым карточки сайта; установите и проверьте его в игре`);
      }
      const target = local.find((f) => f.path === packDatapackPath(d.id));
      if (target && target.info?.sha256 !== source.info.sha256)
        throw new Error(`в ${target.path} уже другая копия — сравните её вручную`);
      items.push({
        id: d.id,
        revision: d.revision,
        sha256: source.info.sha256,
        file: source.file,
        ...(d.snapshotSource ? { sourcePath: d.sourcePath } : {}),
      });
      console.log(`${source.path} → ${packDatapackPath(d.id)} — ${d.name} · ${short(source.info.sha256)}`);
    }
  } else {
    for (const d of selected) {
      items.push({ id: d.id });
      console.log(`${d.path} → ${worldDatapackPath(d.id)} — ${d.name}`);
    }
  }
  if (!items.length) {
    console.log('Переносить нечего.');
    return null;
  }
  if (dryRun) {
    console.log('--dry-run: ничего не менял');
    return null;
  }
  console.log(
    action === 'confirm'
      ? 'Подтверждение означает, что эти версии проверены хостом. Они подключатся во всех мирах; требуется перезапуск игры/сервера.'
      : 'Снимаю подтверждение в сборке. Копия остаётся в снимке мира; следующая догрузка сайта может обновить её.',
  );
  if (!yes) {
    if (!interactive()) throw new Error('подтвердите план флагом --yes');
    if (!(await confirm('Применить этот план?', false))) return null;
  }
  // Повторно проверяем локальный файл перед заливкой; сервер проверит содержимое и ревизию карточки.
  for (const it of items)
    if (it.file) {
      if (hash(fs.readFileSync(it.file)) !== it.sha256)
        throw new Error('ZIP изменился после предпросмотра — повторите команду');
      await api.upload(it.file, it.sha256);
    }
  const r = await api.post('/admin/datapacks', {
    action,
    base: c.snapshot.id,
    items: items.map(({ file: _file, ...it }) => it),
  });
  console.log(`Подтверждение сохранено на сервере: ${r.snapshot}.`);
  console.log('Если локальная догрузка прервётся, повторите tfc pull datapacks. Серверный откат: tfc admin rollback.');
  return { ...r, ids: items.map((d) => d.id) };
}
