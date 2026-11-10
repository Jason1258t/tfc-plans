/** Подтверждение хостом: новый снимок вместе с закреплёнными хешами; до переключения копии мира остаются. */
import fs from 'node:fs/promises';
import {
  datapackContentHash,
  deploymentsOf,
  inspectDatapack,
  packDatapackPath,
  worldDatapackPath,
} from './datapacks.mjs';
import { HttpError, SHA256_RE } from './util.mjs';

/** Тег только добавляет значения: без replace и remove итог игры (TagLoader) не зависит от порядка пакетов. */
function isAdditiveTag(file, bytes) {
  if (!/^data\/[^/]+\/tags\/.+\.json$/.test(file)) return false;
  try {
    const tag = JSON.parse(bytes.toString('utf8'));
    return Array.isArray(tag.values) && tag.replace !== true && !tag.remove?.length;
  } catch {
    return false;
  }
}

/** Два пакета с одним файлом данных уживаются, если файл одинаковый или оба — добавляющие теги, которые игра сложит. */
const canCoexist = (file, a, b) => a.equals(b) || (isAdditiveTag(file, a) && isAdditiveTag(file, b));

/**
 * Подтвердить пакеты поверх набора файлов будущего снимка: проверки ревизии карточки, содержимого ZIP и пересечений
 * данных. Меняет files (Map путь → файл: кладёт ZIP в kubejs/data, убирает копии из мира) и deployments
 * (Map id → запись). Общая для tfc datapacks confirm и одобрения обновления (updates.mjs).
 * item.replaces = { sha256, contentHash, revision } — заменить закреплённую версию: она должна совпасть с записью снимка,
 * а её данные не считаются пересечением с новой версией.
 */
export async function confirmDatapackItems(store, site, current, items, { files, deployments, by }) {
  if (![...files.keys()].some((p) => /^mods\/kubejs-neoforge-2101\./.test(p)))
    throw new HttpError(409, 'В снимке нет поддерживаемого KubeJS для 1.21.1');
  const list = (await site.datapacks([], { all: true, fresh: true })).items;
  const replacedPaths = new Set(items.filter((d) => d?.replaces).map((d) => packDatapackPath(d.id)));
  // Копия в мире под id подтверждаемого пакета — его прежняя версия (её оставил unconfirm), а не чужой пакет:
  // она не пересекается с новой и уходит из снимка вместе с подтверждением.
  const ownWorldPaths = new Set(
    items.filter((d) => /^[A-Za-z0-9]{1,64}$/.test(d?.id ?? '')).map((d) => worldDatapackPath(d.id)),
  );
  const resources = new Map();
  const remember = (pack, label) => {
    for (const [file, bytes] of Object.entries(pack.files)) {
      if (!file.startsWith('data/')) continue;
      const old = resources.get(file);
      if (old && !canCoexist(file, old.bytes, bytes))
        throw new HttpError(
          409,
          `Пересекаются данные ${file}: ${old.label} и ${label}. Сначала устраните разные копии/уточните порядок пакетов`,
        );
      resources.set(file, { bytes, label });
    }
  };
  for (const f of [...files.values()].filter(
    (f) =>
      (f.kind === 'world-datapack' || deploymentsOf(current).some((d) => d.path === f.path)) &&
      f.path.endsWith('.zip') &&
      !replacedPaths.has(f.path) &&
      !ownWorldPaths.has(f.path),
  )) {
    let pack;
    try {
      pack = inspectDatapack(await fs.readFile(store.blobPath(f.sha256)));
    } catch {
      continue;
    }
    // В старом снимке могли уже быть конфликты. Не объявляем их новой ошибкой до проверки выбранных пакетов.
    for (const [file, bytes] of Object.entries(pack.files))
      if (file.startsWith('data/')) {
        const existing = resources.get(file);
        if (existing) existing.variants.push({ bytes, label: f.path });
        else resources.set(file, { bytes, label: f.path, variants: [] });
      }
  }
  for (const item of items) {
    if (!/^[A-Za-z0-9]{1,64}$/.test(item?.id ?? '')) throw new HttpError(400, 'Неверный id датапака');
    let pack = list.find((d) => d.id === item.id);
    let snapshotSource = null;
    if (item.sourcePath) {
      snapshotSource = (await snapshotDatapacks(store, site, current, list)).find(
        (d) => d.id === item.id && d.sourcePath === item.sourcePath && !d.error,
      );
      if (snapshotSource) pack = snapshotSource;
    }
    if (!pack || !item.revision || pack.revision !== item.revision)
      throw new HttpError(409, 'Карточку датапака изменили — перечитайте её и проверьте новую версию');
    const pinned = deployments.get(item.id);
    if (item.replaces) checkReplacement(item, pinned);
    else if (pinned) throw new HttpError(409, 'Датапак уже включён в сборку');
    if (!SHA256_RE.test(item.sha256 ?? '') || !store.hasBlob(item.sha256)) throw new HttpError(400, 'ZIP не загружен');
    let inspected;
    try {
      inspected = inspectDatapack(await fs.readFile(store.blobPath(item.sha256)));
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    const expected = snapshotSource?.contentHash ?? datapackContentHash(await site.datapackSource(pack));
    if (inspected.contentHash !== expected)
      throw new HttpError(409, `«${pack.name}»: проверенная копия не совпадает с карточкой сайта`);
    if (pinned && inspected.contentHash === pinned.contentHash)
      throw new HttpError(409, `«${pack.name}»: в сборке уже такое содержимое, заменять нечем`);
    for (const [file, bytes] of Object.entries(inspected.files))
      for (const old of resources.get(file)?.variants ?? [])
        if (!canCoexist(file, old.bytes, bytes))
          throw new HttpError(409, `Пересекаются данные ${file}: ${old.label} и ${pack.name}`);
    remember(inspected, pack.name);
    const target = packDatapackPath(pack.id);
    const existing = files.get(target);
    if (existing && existing.sha256 !== item.sha256 && existing.sha256 !== item.replaces?.sha256)
      throw new HttpError(409, `Уже есть другой ${target}`);
    const worldPaths = new Set([worldDatapackPath(pack.id), ...(pinned?.worldPaths ?? [])]);
    if (!snapshotSource && files.get(worldDatapackPath(pack.id))?.kind === 'world-datapack')
      files.delete(worldDatapackPath(pack.id));
    // В снимке встречаются ZIP с ручными названиями: убираем только совпавшее содержимое.
    for (const f of [...files.values()].filter((f) => f.kind === 'world-datapack' && f.path.endsWith('.zip'))) {
      try {
        if (inspectDatapack(await fs.readFile(store.blobPath(f.sha256))).contentHash === expected) {
          worldPaths.add(f.path);
          files.delete(f.path);
        }
      } catch {
        // Неизвестный или повреждённый архив оставляем без изменений.
      }
    }
    files.set(target, { path: target, sha256: item.sha256, size: store.blobSize(item.sha256), kind: 'kubejs' });
    deployments.set(pack.id, {
      id: pack.id,
      name: pack.name,
      path: target,
      sha256: item.sha256,
      contentHash: expected,
      revision: pack.revision,
      sourceUpdatedAt: pack.updatedAt ?? 0,
      ...(snapshotSource ? { snapshotSource: true, fileName: snapshotSource.fileName } : {}),
      confirmedAt: Date.now(),
      confirmedBy: by,
      worldPaths: [...worldPaths],
    });
  }
}

/** Заменить можно только закреплённую версию с карточки, которую видел автор: иначе он проверял не то, что заменяет. */
function checkReplacement(item, pinned) {
  if (item.sourcePath) throw new HttpError(400, 'Заменить можно только датапак с карточкой сайта');
  if (!pinned) throw new HttpError(409, 'Датапак уже не закреплён в сборке — заменять нечего');
  if (pinned.snapshotSource) throw new HttpError(409, `«${pinned.name}» закреплён без карточки сайта — заменить нечем`);
  const { sha256, contentHash, revision } = item.replaces;
  if (pinned.sha256 !== sha256 || pinned.contentHash !== contentHash || pinned.revision !== revision)
    throw new HttpError(409, `«${pinned.name}»: закреплённую версию поменяли после предложения`);
}

export async function changeDatapacks(store, site, body, who) {
  const current = await store.getCurrent();
  if (!current || body?.base !== current.id) throw new HttpError(409, 'Сборка изменилась — перечитайте список');
  if (!['confirm', 'unconfirm'].includes(body.action)) throw new HttpError(400, 'Нужно confirm или unconfirm');
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100)
    throw new HttpError(400, 'items — от 1 до 100 пакетов');
  if (new Set(body.items.map((d) => d.id)).size !== body.items.length) throw new HttpError(400, 'Повтор id');
  // Замена идёт только через обновление: его одобряет другой администратор
  if (body.items.some((d) => d.replaces)) throw new HttpError(400, 'Заменить датапак можно только обновлением сборки');
  const deployments = new Map(deploymentsOf(current).map((d) => [d.id, d]));
  const files = new Map(current.files.map((f) => [f.path, f]));
  if (body.action === 'confirm')
    await confirmDatapackItems(store, site, current, body.items, { files, deployments, by: who.name });
  else
    for (const item of body.items) {
      if (!/^[A-Za-z0-9]{1,64}$/.test(item?.id ?? '')) throw new HttpError(400, 'Неверный id датапака');
      const d = deployments.get(item.id);
      if (!d) throw new HttpError(409, 'Датапак уже не включён в сборку');
      const target = d.snapshotSource && d.fileName ? `world/datapacks/${d.fileName}` : worldDatapackPath(d.id);
      const existing = files.get(target);
      if (existing && existing.sha256 !== d.sha256) throw new HttpError(409, `В снимке уже другая копия ${target}`);
      files.set(target, { ...files.get(d.path), path: target, kind: 'world-datapack' });
      files.delete(d.path);
      deployments.delete(d.id);
    }
  // Ревизии источников проверены, указатель снимка ещё защищает от параллельного publish/confirm.
  return store.createSnapshot(
    {
      base: current.id,
      note: `${body.action === 'confirm' ? 'Подтверждение' : 'Снятие подтверждения'} датапаков: ${body.items.length}`,
      mc: current.mc,
      loader: current.loader,
      files: [...files.values()],
    },
    who.name,
    { datapacks: [...deployments.values()] },
  );
}

/** ZIP мира из снимка, у которых нет совпадающей карточки сайта. Неизвестное содержимое не выдаём за проверенное. */
export async function snapshotDatapacks(store, site, snapshot, cards) {
  const known = new Set();
  for (const d of cards) known.add(datapackContentHash(await site.datapackSource(d)));
  const out = [];
  for (const f of snapshot?.files ?? []) {
    if (f.kind !== 'world-datapack' || !f.path.endsWith('.zip')) continue;
    let inspected;
    let error;
    try {
      inspected = inspectDatapack(await fs.readFile(store.blobPath(f.sha256)));
    } catch (e) {
      error = e.message;
    }
    if (inspected && known.has(inspected.contentHash)) continue;
    const fileName = f.path.split('/').at(-1);
    const description = inspected?.description;
    const name = typeof description === 'string' && description.trim() ? description.trim().slice(0, 160) : fileName;
    const id = `zip${(inspected?.contentHash ?? f.sha256).slice(0, 24)}`;
    if (out.some((d) => d.id === id)) continue;
    out.push({
      id,
      name,
      fileName,
      sourcePath: f.path,
      sha256: f.sha256,
      contentHash: inspected?.contentHash ?? null,
      error,
      install: true,
      snapshotSource: true,
      revision: snapshot.id,
    });
  }
  return out;
}
