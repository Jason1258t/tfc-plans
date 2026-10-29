/** Вложения dev:<id> живут в Firestore отдельно от SQLite-задач. Только чтение, с минутным кешем списка. */
import fs from 'node:fs';
import { DOCS, fromValue } from '../firestore-rest.mjs';
import { api } from '../mcp/firestore.mjs';
import { fetchReport } from '../mcp/tools/reports.mjs';

const cache = new Map();
export async function taskFiles(task) {
  if (!Number.isSafeInteger(task) || task < 1) throw new Error('Нужен положительный номер dev-задачи');
  const hit = cache.get(task);
  if (hit?.until > Date.now()) return hit.files;
  const r = await api(`${DOCS}:runQuery`, {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'files' }],
        where: { fieldFilter: { field: { fieldPath: 'taskId' }, op: 'EQUAL', value: { stringValue: `dev:${task}` } } },
      },
    }),
  });
  const files = r
    .filter((x) => x.document)
    .map(({ document: d }) => ({
      id: d.name.split('/').pop(),
      ...Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, fromValue(v)])),
    }))
    .filter((f) => f.complete);
  cache.set(task, { files, until: Date.now() + 60_000 });
  return files;
}

export async function devFileGet(a) {
  const attachment = (await taskFiles(a.task)).find((f) => f.id === a.id);
  if (!attachment) throw new Error(`Вложение ${a.id} не найдено у dev-задачи #${a.task}`);
  const { files } = await fetchReport(attachment.id);
  const images = [];
  // Изображение передаётся без перекодирования; крупные файлы доступны по локальному пути.
  const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
  for (const f of files) {
    const mimeType = mime[f.rel.split('.').pop().toLowerCase()];
    if (mimeType && f.size <= 10 * 1024 * 1024)
      images.push({ data: fs.readFileSync(f.full).toString('base64'), mimeType });
  }
  return {
    text: `Вложение #${a.task}: «${attachment.name}»\n${files.map((f) => `${f.rel} (${f.size} Б): ${f.full}`).join('\n')}`,
    images,
  };
}
