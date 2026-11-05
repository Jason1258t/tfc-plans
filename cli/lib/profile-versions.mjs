import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from './scan.mjs';
import { launcherRunning, profileFiles, validVersionName } from './vanilla.mjs';

const samePath = (a, b) => {
  const normalize = (p) => {
    const resolved = path.resolve(p).normalize('NFC');
    return process.platform === 'linux' ? resolved : resolved.toLowerCase();
  };
  return Boolean(a && b && normalize(a) === normalize(b));
};
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

function managedVersion(profile) {
  const { mcDir, version = path.basename(profile.instance) } = profile.launcher ?? {};
  if (profile.side !== 'client' || !mcDir || !validVersionName(version)) return null;
  const dir = path.resolve(mcDir, 'versions', version);
  const instance = path.resolve(profile.instance);
  if (!samePath(instance, dir) && !samePath(instance, mcDir)) return null;
  if (!fs.existsSync(dir)) return null;
  const file = path.join(dir, `${version}.json`);
  const expectedDir = path.join(fs.realpathSync(mcDir), 'versions', version);
  if (
    !samePath(fs.realpathSync(dir), expectedDir) ||
    !samePath(fs.realpathSync(file), path.join(expectedDir, path.basename(file))) ||
    read(file).id !== version
  )
    throw new Error(`не удалось подтвердить принадлежность версии ${dir} программе tfc`);
  return { dir, instance, mcDir, version, file };
}

function launcherFiles(target, files) {
  for (const file of profileFiles(target.mcDir)) {
    if (!files.has(file)) files.set(file, read(file));
    const data = files.get(file);
    for (const [id, profile] of Object.entries(data.profiles ?? {})) {
      const usesFolder = samePath(profile.gameDir, target.dir);
      if (profile.lastVersionId !== target.version && !usesFolder) continue;
      if (profile.lastVersionId !== target.version || !samePath(profile.gameDir, target.instance))
        throw new Error(`версию ${target.version} использует другой профиль лаунчера «${profile.name ?? id}»`);
    }
  }
}

function changeFiles(changes, save) {
  const originals = new Map();
  try {
    for (const [file, data] of changes) {
      originals.set(file, fs.existsSync(file) ? fs.readFileSync(file) : null);
      write(file, data);
    }
    save();
  } catch (error) {
    for (const [file, original] of originals) {
      if (original) fs.writeFileSync(file, original);
      else fs.rmSync(file, { force: true });
    }
    throw error;
  }
}

function assertLauncherClosed() {
  if (launcherRunning()) throw new Error('закройте лаунчер и повторите');
}

function relocate(value, from, to) {
  if (!value) return value;
  const relative = path.relative(from, value);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return value;
  return path.join(to, relative);
}

function relocatedState(profile, dir, dest, changes) {
  const state = stateDir(profile);
  const rebase = (value) => relocate(value, dir, dest);
  const update = (data) => {
    if (!data) return;
    data.world = rebase(data.world);
    for (const group of Object.values(data.pulled ?? {}))
      for (const entry of Object.values(group)) entry.world = rebase(entry.world);
  };
  const file = path.join(state, 'state.json');
  if (fs.existsSync(file)) {
    const data = read(file);
    update(data);
    changes.set(rebase(file), data);
  }
  const backups = path.join(state, 'backup');
  if (!fs.existsSync(backups)) return;
  for (const entry of fs.readdirSync(backups)) {
    const file = path.join(backups, entry, 'manifest.json');
    if (!fs.existsSync(file)) continue;
    const data = read(file);
    data.world = rebase(data.world);
    for (const edit of data.edited ?? []) edit.target = rebase(edit.target);
    update(data.prevState);
    changes.set(rebase(file), data);
  }
}

export function renameVersion(profile, name, others, save) {
  if (!validVersionName(name) || name.length > 61)
    throw new Error('выберите допустимое имя папки до 61 символа, отличное от версии Minecraft и NeoForge');
  const target = managedVersion(profile);
  if (!target) throw new Error('переименование версии доступно для сборок, установленных через tfc init --launcher');
  if (target.version === name) return save(profile);
  const { dir, instance, file, version, mcDir } = target;
  const dest = path.join(path.dirname(dir), name);
  if (fs.readdirSync(path.dirname(dir)).some((entry) => samePath(path.join(path.dirname(dir), entry), dest)))
    throw new Error(`версия ${name} уже существует`);
  if (
    others.some(
      (other) =>
        [dir, dest].some((p) => samePath(other.instance, p)) ||
        (samePath(other.launcher?.mcDir, mcDir) && other.launcher.version === version),
    )
  )
    throw new Error(`папка версии ${version} связана с другим профилем tfc`);

  assertLauncherClosed();
  const changes = new Map();
  launcherFiles(target, changes);
  const nextInstance = samePath(instance, dir) ? dest : instance;
  for (const data of changes.values()) {
    for (const entry of Object.values(data.profiles ?? {})) {
      if (entry.lastVersionId !== version) continue;
      entry.lastVersionId = name;
      entry.gameDir = nextInstance;
      if (entry.name === version || (version === 'TFC-RealWorld' && entry.name === 'TFC RealWorld')) entry.name = name;
    }
  }

  const next = { ...profile, instance: nextInstance, launcher: { ...profile.launcher, version: name } };
  for (const field of ['world', 'serverDir']) next[field] = relocate(profile[field], dir, dest);
  const newFile = path.join(dest, `${name}.json`);
  if (fs.existsSync(path.join(dir, `${name}.json`))) throw new Error(`в папке версии уже есть ${name}.json`);
  const oldData = fs.readFileSync(file);
  changes.set(newFile, { ...JSON.parse(oldData), id: name });
  if (nextInstance === dest) relocatedState(profile, dir, dest, changes);
  const tlFile = path.join(dir, 'TLauncherAdditional.json');
  if (fs.existsSync(tlFile)) {
    const tl = read(tlFile);
    if (tl.modpack) tl.modpack.name = name;
    changes.set(path.join(dest, path.basename(tlFile)), tl);
  }
  fs.renameSync(dir, dest);
  const movedFile = path.join(dest, path.basename(file));
  try {
    fs.unlinkSync(movedFile);
    changeFiles(changes, () => save(next));
  } catch (error) {
    fs.writeFileSync(movedFile, oldData);
    fs.renameSync(dest, dir);
    throw error;
  }
}

export function deletableVersions(profiles, selected) {
  const targets = [];
  for (const [name, profile] of Object.entries(profiles)) {
    if (selected && name !== selected) continue;
    const target = managedVersion(profile);
    if (target && samePath(target.dir, target.instance)) targets.push({ ...target, name });
    else if (selected) throw new Error(`профиль «${name}» не связан с отдельной версией, установленной tfc`);
  }
  for (const { dir, name } of targets) {
    if (
      Object.entries(profiles).some(
        ([key, p]) =>
          key !== name &&
          [p.instance, p.world, p.serverDir].some((value) => value && relocate(value, dir, dir + '-check') !== value),
      )
    )
      throw new Error(`папку ${dir} использует другой профиль tfc`);
  }
  return targets;
}

export function deleteVersions(targets, save) {
  if (!targets.length) return;
  assertLauncherClosed();
  const changes = new Map();
  for (const target of targets) launcherFiles(target, changes);
  for (const [file, data] of changes) {
    for (const [id, entry] of Object.entries(data.profiles ?? {})) {
      if (
        targets.some(
          (target) =>
            samePath(path.dirname(file), target.mcDir) &&
            entry.lastVersionId === target.version &&
            samePath(entry.gameDir, target.dir),
        )
      )
        delete data.profiles[id];
    }
  }
  const moved = [];
  try {
    for (const { dir } of targets) {
      const trash = fs.mkdtempSync(path.join(path.dirname(dir), '.tfc-delete-'));
      moved.push({ dir, trash });
      fs.renameSync(dir, path.join(trash, 'version'));
    }
    changeFiles(changes, save);
  } catch (error) {
    for (const { dir, trash } of moved.reverse()) {
      const version = path.join(trash, 'version');
      if (fs.existsSync(version)) fs.renameSync(version, dir);
      fs.rmdirSync(trash);
    }
    throw error;
  }
  for (const { trash } of moved) {
    try {
      fs.rmSync(trash, { recursive: true });
    } catch (error) {
      console.warn(`Не удалось очистить ${trash}: ${error.message}`);
    }
  }
}
