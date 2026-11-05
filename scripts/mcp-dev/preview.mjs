/**
 * Предпросмотр ворктри в приложении Claude: preview_start берёт конфиг из .claude/launch.json основной копии, и запись
 * без --prefix показывает код main. Здесь — запись на ворктри (свой порт); записи удалённых ворктри убираются сами.
 */
import fs from 'node:fs';
import path from 'node:path';

const FIRST_PORT = 5190; // ниже — dev, dev-alt и порты из docs/agents.md

const launchFile = (root) => path.join(root, '.claude', 'launch.json');

function readLaunch(root) {
  let raw;
  try {
    raw = fs.readFileSync(launchFile(root), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { version: '0.0.1', configurations: [] };
    throw e;
  }
  const cfg = JSON.parse(raw);
  if (!Array.isArray(cfg.configurations)) throw new Error('нет configurations');
  return cfg;
}

function writeLaunch(root, cfg) {
  const file = launchFile(root);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function prefixOf(entry) {
  const args = entry.runtimeArgs ?? [];
  const i = args.indexOf('--prefix');
  return i < 0 ? null : args[i + 1];
}

/** Убрать записи ворктри, которых больше нет; записи вне .claude/worktrees не трогаем. Вернуть, сколько убрано */
function pruneGone(root, cfg) {
  const base = path.join(root, '.claude', 'worktrees') + path.sep;
  const before = cfg.configurations.length;
  cfg.configurations = cfg.configurations.filter((c) => {
    const prefix = prefixOf(c);
    return !prefix?.startsWith(base) || fs.existsSync(prefix);
  });
  return before - cfg.configurations.length;
}

/** Запись предпросмотра ворктри: готовая или новая. Вернуть { name, port } */
export function ensurePreview(root, wt, short) {
  const cfg = readLaunch(root);
  const removed = pruneGone(root, cfg);
  let entry = cfg.configurations.find((c) => prefixOf(c) === wt);
  if (!entry) {
    const taken = new Set(cfg.configurations.map((c) => c.port));
    let port = FIRST_PORT;
    while (taken.has(port)) port++;
    entry = {
      name: `wt-${short}`,
      runtimeExecutable: 'npm',
      runtimeArgs: ['--prefix', wt, 'run', 'dev', '--', '--port', String(port), '--strictPort'],
      port,
    };
    cfg.configurations.push(entry);
    writeLaunch(root, cfg);
  } else if (removed) writeLaunch(root, cfg);
  return { name: entry.name, port: entry.port };
}

/** После удаления ворктри: убрать его запись. Ошибка launch.json не должна мешать сдаче — вернуть предупреждение */
export function forgetGonePreviews(root) {
  try {
    if (!fs.existsSync(launchFile(root))) return '';
    const cfg = readLaunch(root);
    if (pruneGone(root, cfg)) writeLaunch(root, cfg);
    return '';
  } catch (e) {
    return `⚠ .claude/launch.json не обновлён: ${e.message}`;
  }
}

/** Строка для ответа инструмента: как открыть предпросмотр. Сломанный launch.json не мешает созданию ворктри */
export function previewHint(root, wt, short) {
  try {
    const { name, port } = ensurePreview(root, wt, short);
    return `Предпросмотр ворктри: preview_start name=${name} (порт ${port}); без приложения Claude — в ворктри npm run dev -- --port ${port} --strictPort.`;
  } catch (e) {
    return `⚠ запись предпросмотра не добавлена: .claude/launch.json — ${e.message}`;
  }
}
