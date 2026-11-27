/** Хранилище неизменяемых байтов; материализация всегда копирует и проверяет содержимое. */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { canonicalJson, checkRef } from './contract.mjs';
import { relativeFile } from './files.mjs';

export class ArtifactStore {
  constructor(root) {
    this.root = path.resolve(root);
  }
  file(ref) {
    checkRef(ref, 'artifact');
    return path.join(this.root, 'blobs', ref.sha256);
  }
  async init() {
    await fsp.mkdir(path.join(this.root, 'blobs'), { recursive: true });
  }
  async putJSON(value) {
    return this.putBytes(Buffer.from(canonicalJson(value)));
  }
  async putBytes(bytes) {
    await this.init();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const tmp = path.join(this.root, 'blobs', `.put-${randomBytes(12).toString('hex')}`);
    try {
      await fsp.writeFile(tmp, bytes, { flag: 'wx' });
      await fsp.rename(tmp, this.file({ sha256 }));
      return { sha256, size: bytes.length };
    } finally {
      await fsp.rm(tmp, { force: true });
    }
  }
  async putFile(source, { signal } = {}) {
    signal?.throwIfAborted();
    await this.init();
    const st = await fsp.lstat(source);
    if (!st.isFile()) throw new Error(`Вход не обычный файл: ${source}`);
    const tmp = path.join(this.root, 'blobs', `.put-${randomBytes(12).toString('hex')}`);
    const hash = createHash('sha256');
    let size = 0;
    try {
      await pipeline(
        fs.createReadStream(source, { flags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW }),
        new Transform({
          transform(chunk, encoding, done) {
            size += chunk.length;
            hash.update(chunk);
            done(null, chunk);
          },
        }),
        fs.createWriteStream(tmp, { flags: 'wx' }),
        { signal },
      );
      const after = await fsp.lstat(source);
      if (
        !after.isFile() ||
        st.ino !== after.ino ||
        st.size !== after.size ||
        st.mtimeMs !== after.mtimeMs ||
        size !== st.size
      )
        throw new Error(`Вход менялся при фиксации: ${source}`);
      const sha256 = hash.digest('hex');
      await fsp.rename(tmp, this.file({ sha256 }));
      return { sha256, size };
    } finally {
      await fsp.rm(tmp, { force: true });
    }
  }
  async read(ref, { signal } = {}) {
    signal?.throwIfAborted();
    const file = this.file(ref);
    if (!(await fsp.lstat(file)).isFile()) throw new Error('Артефакт не обычный файл');
    const data = await fsp.readFile(file, { signal });
    if (
      createHash('sha256').update(data).digest('hex') !== ref.sha256 ||
      (ref.size !== undefined && data.length !== ref.size)
    )
      throw new Error(`Повреждён артефакт ${ref.sha256}`);
    return data;
  }
  async json(ref, options) {
    return JSON.parse((await this.read(ref, options)).toString('utf8'));
  }
  async captureTree(directory, options = {}) {
    const root = await fsp.realpath(directory);
    if (!(await fsp.lstat(root)).isDirectory()) throw new Error('Источник дерева не каталог');
    const files = [];
    const walk = async (prefix = '') => {
      for (const name of (await fsp.readdir(path.join(root, prefix))).sort()) {
        options.signal?.throwIfAborted();
        const rel = relativeFile(prefix ? `${prefix}/${name}` : name);
        let file = path.join(root, rel);
        let st = await fsp.lstat(file);
        // JDK содержит внутренние ссылки на лицензии: фиксируем их байты, а не живую ссылку.
        if (st.isSymbolicLink()) {
          file = await fsp.realpath(file);
          const resolved = path.relative(root, file);
          if (!resolved || resolved === '..' || resolved.startsWith(`..${path.sep}`) || path.isAbsolute(resolved))
            throw new Error(`Ссылка выходит из входного дерева: ${rel}`);
          st = await fsp.lstat(file);
          if (!st.isFile()) throw new Error(`Ссылка не на обычный файл: ${rel}`);
        }
        if (st.isDirectory()) await walk(rel);
        else if (st.isFile())
          files.push({ path: rel, ...(await this.putFile(file, options)), executable: Boolean(st.mode & 0o111) });
        else throw new Error(`Ссылка или специальный файл во входах: ${rel}`);
      }
    };
    await walk();
    return this.putJSON({ schemaVersion: 1, type: 'tree', files });
  }
  async tree(ref, options) {
    const tree = await this.json(ref, options);
    if (tree?.schemaVersion !== 1 || tree.type !== 'tree' || !Array.isArray(tree.files))
      throw new Error('Некорректное дерево артефактов');
    const names = new Set();
    for (const file of tree.files) {
      relativeFile(file.path);
      checkRef(file, 'tree.file');
      if (
        names.has(file.path) ||
        typeof file.executable !== 'boolean' ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0
      )
        throw new Error(`Некорректный файл дерева: ${file.path}`);
      names.add(file.path);
    }
    for (const name of names) {
      const parts = name.split('/');
      while ((parts.pop(), parts.length))
        if (names.has(parts.join('/'))) throw new Error('Файл дерева одновременно является каталогом');
    }
    return tree;
  }
  async materialize(ref, destination, { signal, overlay = false } = {}) {
    const tree = await this.tree(ref, { signal });
    await fsp.mkdir(destination, { recursive: true });
    if (!(await fsp.lstat(destination)).isDirectory()) throw new Error('Назначение дерева не каталог');
    for (const entry of tree.files) {
      signal?.throwIfAborted();
      const parts = entry.path.split('/');
      let parent = destination;
      for (const part of parts.slice(0, -1)) {
        parent = path.join(parent, part);
        await fsp.mkdir(parent, { recursive: true });
        if (!(await fsp.lstat(parent)).isDirectory()) throw new Error('Ссылка или файл вместо каталога');
      }
      const file = path.join(destination, entry.path);
      const old = await fsp.lstat(file).catch((e) => {
        if (e.code !== 'ENOENT') throw e;
        return null;
      });
      if (old && (!overlay || !old.isFile())) throw new Error(`Конфликт файла: ${entry.path}`);
      const tmp = `${file}.stand-${randomBytes(8).toString('hex')}`;
      try {
        const source = this.file(entry);
        if (!(await fsp.lstat(source)).isFile()) throw new Error('Артефакт не обычный файл');
        const hash = createHash('sha256');
        let size = 0;
        await pipeline(
          fs.createReadStream(source, { flags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW }),
          new Transform({
            transform(chunk, encoding, done) {
              size += chunk.length;
              hash.update(chunk);
              done(null, chunk);
            },
          }),
          fs.createWriteStream(tmp, { flags: 'wx' }),
          { signal },
        );
        if (size !== entry.size || hash.digest('hex') !== entry.sha256) throw new Error(`Повреждён файл ${entry.path}`);
        await fsp.chmod(tmp, entry.executable ? 0o755 : 0o644);
        await fsp.rename(tmp, file);
      } finally {
        await fsp.rm(tmp, { force: true });
      }
    }
    return tree;
  }
}
