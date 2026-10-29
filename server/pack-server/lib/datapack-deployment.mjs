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

export async function changeDatapacks(store, site, body, who) {
  const current = await store.getCurrent();
  if (!current || body?.base !== current.id) throw new HttpError(409, 'Сборка изменилась — перечитайте список');
  if (!['confirm', 'unconfirm'].includes(body.action)) throw new HttpError(400, 'Нужно confirm или unconfirm');
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100)
    throw new HttpError(400, 'items — от 1 до 100 пакетов');
  if (new Set(body.items.map((d) => d.id)).size !== body.items.length) throw new HttpError(400, 'Повтор id');
  const deployments = new Map(deploymentsOf(current).map((d) => [d.id, d]));
  const files = new Map(current.files.map((f) => [f.path, f]));
  if (body.action === 'confirm' && !current.files.some((f) => /^mods\/kubejs-neoforge-2101\./.test(f.path)))
    throw new HttpError(409, 'В снимке нет поддерживаемого KubeJS для 1.21.1');
  const list = body.action === 'confirm' ? (await site.datapacks([], { all: true, fresh: true })).items : [];
  const resources = new Map();
  const remember = (pack, label) => {
    for (const [file, bytes] of Object.entries(pack.files)) {
      if (!file.startsWith('data/')) continue;
      const old = resources.get(file);
      if (old && !old.bytes.equals(bytes))
        throw new HttpError(
          409,
          `Пересекаются данные ${file}: ${old.label} и ${label}. Сначала устраните разные копии/уточните порядок пакетов`,
        );
      resources.set(file, { bytes, label });
    }
  };
  if (body.action === 'confirm') {
    for (const f of current.files.filter(
      (f) =>
        (f.kind === 'world-datapack' || deploymentsOf(current).some((d) => d.path === f.path)) &&
        f.path.endsWith('.zip'),
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
  }
  for (const item of body.items) {
    if (!/^[A-Za-z0-9]{1,64}$/.test(item?.id ?? '')) throw new HttpError(400, 'Неверный id датапака');
    if (body.action === 'unconfirm') {
      const d = deployments.get(item.id);
      if (!d) throw new HttpError(409, 'Датапак уже не включён в сборку');
      const target = d.snapshotSource && d.fileName ? `world/datapacks/${d.fileName}` : worldDatapackPath(d.id);
      const existing = files.get(target);
      if (existing && existing.sha256 !== d.sha256) throw new HttpError(409, `В снимке уже другая копия ${target}`);
      files.set(target, { ...files.get(d.path), path: target, kind: 'world-datapack' });
      files.delete(d.path);
      deployments.delete(d.id);
      continue;
    }
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
    if (deployments.has(item.id)) throw new HttpError(409, 'Датапак уже включён в сборку');
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
    for (const [file, bytes] of Object.entries(inspected.files))
      for (const old of resources.get(file)?.variants ?? [])
        if (!old.bytes.equals(bytes))
          throw new HttpError(409, `Пересекаются данные ${file}: ${old.label} и ${pack.name}`);
    remember(inspected, pack.name);
    const target = packDatapackPath(pack.id);
    const existing = files.get(target);
    if (existing && existing.sha256 !== item.sha256) throw new HttpError(409, `Уже есть другой ${target}`);
    const worldPaths = new Set([worldDatapackPath(pack.id)]);
    // В снимке встречаются ZIP с ручными названиями: убираем только совпавшее содержимое.
    for (const f of current.files.filter((f) => f.kind === 'world-datapack' && f.path.endsWith('.zip'))) {
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
      confirmedBy: who.name,
      worldPaths: [...worldPaths],
    });
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
