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
} from '@tfc/pack-server/datapacks';
import { datapackFiles, zipName } from '@tfc/core/datapackFiles';
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

export async function datapackCatalog(api, { refresh = false } = {}) {
  const [inventory, snapshot] = await Promise.all([
    api.get(`/site/datapacks?all=true&v=2${refresh ? '&fresh=true' : ''}`),
    api.current(),
  ]);
  if (!Array.isArray(inventory.deployed))
    throw new Error('сервер ещё не поддерживает уровни датапаков — обновите сервер сборки');
  if (inventory.snapshot !== (snapshot?.id ?? null))
    throw new Error('сборка изменилась во время чтения — повторите команду');
  const items = inventory.items.map((d) => ({ ...d, contentHash: datapackContentHash(datapackFiles(d)) }));
  const deployed = deploymentsOf(snapshot);
  for (const d of items) d.deployment = deployed.find((p) => p.id === d.id);
  for (const d of deployed) {
    if (!items.some((p) => p.id === d.id)) items.push({ ...d, deployment: d, sourceMissing: true, install: false });
  }
  return { items: [...items, ...(inventory.snapshotItems ?? [])], snapshot, deployed };
}

function matches(d, query) {
  return [
    d.id,
    d.name,
    d.fileName,
    d.deployment?.name,
    d.deployment?.fileName,
    d.deployment?.path.split('/').at(-1),
    zipName(d),
    `tfc-plans-${d.id}.zip`,
    ...(d.worldPaths ?? d.deployment?.worldPaths ?? []).map((p) => p.split('/').at(-1)),
  ].some((s) => s && key(s) === key(query));
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

export async function resolveDatapacks(api, catalog, items, names) {
  if (!names.length || (names.length === 1 && names[0] === 'all')) return select(items, names);
  const resolved = [];
  for (const n of names) {
    if (items.some((d) => matches(d, n))) {
      resolved.push(n);
      continue;
    }
    const ids = new Set();
    for (const f of catalog.snapshot?.files ?? []) {
      if (
        path.posix.basename(f.path) !== n ||
        !f.path.endsWith('.zip') ||
        !(f.kind === 'world-datapack' || isPackDatapackPath(f.path))
      )
        continue;
      try {
        const content = inspectDatapack(await api.bytes(`/blobs/${f.sha256}`)).contentHash;
        for (const d of items) if (d.contentHash === content) ids.add(d.id);
      } catch {
        /* Повреждённый архив не является источником подтверждения. */
      }
    }
    if (ids.size !== 1)
      throw new Error(
        ids.size ? `«${n}»: разные пакеты с одним filename — укажите id` : `нет датапака «${n}» — tfc datapacks files`,
      );
    resolved.push([...ids][0]);
  }
  return select(items, resolved);
}

export async function listDatapacks(api, profile, query = '', filesOnly = false) {
  const c = await datapackCatalog(api);
  const local = profile ? localDatapacks(profile) : [];
  console.log(`Датапаки сайта; снимок ${c.snapshot?.id ?? 'ещё не опубликован'}`);
  if (!filesOnly) {
    const shown = c.items.filter((d) => key(`${d.id} ${d.name} ${zipName(d)}`).includes(key(query)));
    console.log(`\nНа сайте: ${shown.length}`);
    for (const d of shown) {
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
        `  ${d.id} | ${d.name} | ${state}${d.sourceMissing ? ' | без карточки сайта' : d.snapshotSource ? ' | ZIP снимка без карточки' : ''}${d.error ? ` | ${d.error}` : ''}`,
      );
    }
    if (!shown.length) console.log('  (пусто)');
  }
  console.log('\nФайлы снимка: filename | название | место | sha256');
  let snapShown = 0;
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
    snapShown++;
    console.log(
      `  ${path.posix.basename(f.path)} | ${d ? `${d.name}${d.snapshotSource ? ' (нет карточки сайта)' : ''}` : 'неизвестный датапак'} | ${f.path} | ${short(f.sha256)}`,
    );
  }
  if (!snapShown) console.log('  (пусто)');
  if (profile && !filesOnly) {
    console.log(`\nЛокальные ZIP (${profile.world ? `мир: ${profile.world}` : 'мир не выбран'}):`);
    let localShown = 0;
    for (const f of local) {
      const d =
        c.items.find((d) => d.contentHash === f.info?.contentHash) ??
        c.deployed.find((d) => d.contentHash === f.info?.contentHash);
      if (!key(`${f.path} ${d?.name ?? ''}`).includes(key(query))) continue;
      localShown++;
      console.log(
        `  ${f.path} | ${d?.name ?? 'неизвестный или изменённый датапак'} | ${short(f.info?.sha256)}${f.error ? ` | ${f.error}` : ''}`,
      );
    }
    if (!localShown) console.log('  (пусто)');
  }
  if (!filesOnly)
    console.log(dim('\nДетали: tfc datapacks <имя/id/filename>; догрузить: tfc datapacks pull <имя/id/filename>'));
}

export async function showDatapacks(api, profile, names) {
  const c = await datapackCatalog(api);
  const selected = await resolveDatapacks(api, c, c.items, names);
  for (const d of selected) {
    const pin = d.deployment;
    console.log(`${d.id} — ${d.name}`);
    console.log(
      `  ${pin ? `В сборке: ${pin.path}; проверенное содержимое ${short(pin.contentHash)}` : `Для проверки в мире: ${d.sourcePath ?? worldDatapackPath(d.id)}`}`,
    );
    if (pin && d.contentHash !== pin.contentHash)
      console.log('  На сайте новая редакция; pull получает подтверждённую версию сборки.');
    console.log(`  Догрузить: tfc datapacks pull ${d.id}`);
    if (pin) console.log(`  Для проверки новой версии хостом: tfc datapacks unconfirm ${d.id}`);
    if (!pin && !profile?.world) console.log('  Для установки выберите мир: tfc init --world <мир>');
  }
}

/** Имена разрешаем до pull: одинаковые названия не должны незаметно выбирать два разных датапака. */
export async function datapackIds(api, names, { hasWorld = true } = {}) {
  const c = await datapackCatalog(api, { refresh: true });
  const selected = await resolveDatapacks(api, c, c.items, names);
  const needWorld = selected.filter((d) => !d.deployment);
  if (!hasWorld && needWorld.length)
    throw new Error(
      `Для проверки в мире нужен выбранный мир: ${needWorld.map((d) => d.name).join(', ')}. Выполните tfc init --world <мир>. Подтверждённые пакеты сборки можно pull без мира.`,
    );
  return selected.map((d) => d.id);
}

export async function confirmDatapacks(api, profile, names, { yes = false, dryRun = false, action = 'confirm' } = {}) {
  // Права проверяем даже при предпросмотре, до загрузки файлов.
  if ((await api.role()) !== 'admin') throw new Error('подтверждать датапаки может только хост (ключ администратора)');
  const c = await datapackCatalog(api, { refresh: true });
  if (!profile.world) throw new Error('для переноса выберите мир: tfc init --world <мир>');
  if (!c.snapshot) throw new Error('сначала опубликуйте снимок сборки');
  const all = !names.length || (names.length === 1 && names[0] === 'all');
  const local = localDatapacks(profile);
  let selected = await resolveDatapacks(api, c, action === 'confirm' ? c.items : c.deployed, names);
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
      console.log(
        `${d.path} → ${d.snapshotSource && d.fileName ? `world/datapacks/${d.fileName}` : worldDatapackPath(d.id)} — ${d.name}`,
      );
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
