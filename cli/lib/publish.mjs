/**
 * Заливка сборки на сервер (хост): разница с текущим снимком, предупреждение о чужих правках, заливка только
 * недостающих файлов, новый снимок и (по умолчанию) переключение текущего на него.
 */
import { saveState, loadState } from './plan.mjs';
import { bold, confirm, dim, interactive, mb, progress, yellow } from './ui.mjs';

/** Разница двух списков файлов: { added, changed, removed } — пути */
export function diffFiles(fromFiles, toFiles) {
  const a = new Map(fromFiles.map((f) => [f.path, f.sha256]));
  const b = new Map(toFiles.map((f) => [f.path, f.sha256]));
  const added = [...b.keys()].filter((p) => !a.has(p));
  const removed = [...a.keys()].filter((p) => !b.has(p));
  const changed = [...b.keys()].filter((p) => a.has(p) && a.get(p) !== b.get(p));
  return { added, changed, removed };
}

const byTop = (paths) => {
  const m = new Map();
  for (const p of paths) {
    const top = p.startsWith('world/') ? p.split('/').slice(0, 2).join('/') : p.split('/')[0];
    m.set(top, (m.get(top) ?? 0) + 1);
  }
  return [...m].map(([k, n]) => `${k} ${n}`).join(', ');
};

export function printDiff(d, { limit = 12 } = {}) {
  const show = (title, list, mark) => {
    if (!list.length) return;
    console.log(`  ${title}: ${list.length} ${dim(`(${byTop(list)})`)}`);
    for (const p of list.slice(0, limit)) console.log(`    ${mark} ${p}`);
    if (list.length > limit) console.log(dim(`    … ещё ${list.length - limit}`));
  };
  show('новые', d.added, '+');
  show('изменённые', d.changed, '~');
  show('убраны', d.removed, '−');
}

export async function publish({ api, profile, local, current, note, mc, loader, yes, force, setCurrent = true }) {
  const files = [...local.values()].map((f) => ({ path: f.path, sha256: f.sha256, size: f.size, kind: f.kind }));
  const d = diffFiles(current?.files ?? [], files);
  if (current && !d.added.length && !d.changed.length && !d.removed.length) {
    console.log('Сборка на сервере уже такая же — заливать нечего.');
    return null;
  }
  console.log(
    current ? `Отличия от сборки на сервере (${dim(current.id)}):` : 'На сервере сборки ещё нет — первая заливка.',
  );
  if (current) printDiff(d);

  // Сборку меняли после нашей прошлой синхронизации (tfc config set с другого устройства) — заливка это затрёт
  const state = loadState(profile);
  if (current && state.snapshot && state.snapshot !== current.id) {
    let base = null;
    try {
      base = await api.get(`/pack/snapshots/${encodeURIComponent(state.snapshot)}`);
    } catch {
      /* старый снимок удалён — сравнить не с чем */
    }
    const theirs = base ? diffFiles(base.files, current.files) : null;
    const ours = new Set([...d.added, ...d.changed, ...d.removed]);
    const lost = theirs ? [...theirs.added, ...theirs.changed, ...theirs.removed].filter((p) => ours.has(p)) : [];
    if (!base || lost.length) {
      console.log(
        yellow(
          base
            ? `\nСборку на сервере меняли после вашей последней синхронизации (${current.author ?? '?'}). Заливка вернёт эти файлы к вашим:`
            : '\nСборку на сервере меняли после вашей последней синхронизации, а ваш прежний снимок уже не найти.',
        ),
      );
      for (const p of lost.slice(0, 20)) console.log(`    ! ${p}`);
      if (!force) {
        console.log(yellow('Сначала заберите их: tfc sync config — или залейте поверх: tfc publish --force'));
        return null;
      }
    }
  }

  const unique = [...new Map(files.map((f) => [f.sha256, f])).values()];
  const { missing } = await api.post('/blobs/missing', { sha256: unique.map((f) => f.sha256) });
  const need = unique.filter((f) => missing.includes(f.sha256));
  const total = need.reduce((s, f) => s + f.size, 0);
  console.log(
    `\nВсего файлов ${files.length}; залить на сервер ${need.length} (${mb(total)}), остальные там уже есть.`,
  );
  if (!yes) {
    if (!interactive()) throw new Error('подтвердите заливку: tfc publish --yes');
    if (!(await confirm('Заливать?', true))) return null;
  }

  if (need.length) {
    const bar = progress('заливка', total);
    for (const f of need) await api.upload(local.get(f.path).file, f.sha256, (n) => bar.add(n));
    bar.end();
  }
  const snap = await api.post('/pack/snapshots', { note: note ?? '', mc, loader, files });
  if (setCurrent) await api.post('/pack/current', { id: snap.id });
  saveState(profile, { snapshot: snap.id, files: Object.fromEntries(files.map((f) => [f.path, f.sha256])) });
  console.log(
    `${bold('Готово:')} снимок ${snap.id}${setCurrent ? ' — теперь он текущий' : ` (текущий не менял: tfc admin use ${snap.id})`}.`,
  );
  return snap;
}
