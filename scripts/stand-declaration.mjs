/** TFC-адаптер самостоятельного стенда: только пути настройки и оформление ответа MCP. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ArtifactStore } from '@tfc/minecraft-stand/store';
import { freezeJob } from '@tfc/minecraft-stand/bundle';
import { submitTarget, waitTarget, requestTarget, pullTarget } from '@tfc/minecraft-stand/transport';
import { QUEUE_ID } from '@tfc/minecraft-stand/queue';
const states = { queued: 'в очереди', running: 'идёт', done: 'завершено', error: 'ошибка', cancelled: 'отменено' };
const verdicts = { passed: 'пройдена', failed: 'провалена', unknown: 'неизвестна' };
const LOCAL = path.resolve(
  process.env.TFC_STAND_CACHE ?? path.join(os.homedir(), '.cache', 'tfc-plans', 'stand-declarations'),
);
export const declarationId = (id) => QUEUE_ID.test(id);
async function target() {
  const file = process.env.TFC_STAND_TARGET;
  if (!file)
    throw new Error(
      'Самостоятельный worker не настроен: TFC_STAND_TARGET должен указывать на target.json установленного стенда',
    );
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
export async function submitDeclaration(file, { key, note = '', by = '' } = {}) {
  const spec = JSON.parse(await fs.readFile(file, 'utf8'));
  const store = new ArtifactStore(path.join(LOCAL, 'inputs'));
  const frozen = await freezeJob(spec, store, { base: path.dirname(path.resolve(file)) });
  const result = await submitTarget(frozen.ref, store, await target(), { key: key ?? frozen.ref.sha256, note, by });
  return { id: result.job.id, position: result.position, ref: frozen.ref };
}
export async function retryDeclaration(id, key, { note = '', by = '' } = {}) {
  if (!declarationId(id)) throw new Error('retry требует id самостоятельного задания stand-…');
  if (!key) throw new Error('Для повтора нужен requestKey');
  const result = await requestTarget(await target(), {
    method: 'POST',
    path: `/jobs/${id}/retry`,
    body: { key, note, by },
  });
  return { id: result.job.id, position: result.position, ref: result.job.ref };
}
export async function waitDeclaration(id, options = {}) {
  const connection = await target(),
    view = await waitTarget(connection, id, options);
  let local = null;
  const pngs = [];
  if (view.reason === 'final') {
    local = await pullTarget(connection, view.job, path.join(LOCAL, 'results', id));
    if (local) {
      const walk = async (dir) => {
        for (const item of await fs.readdir(dir, { withFileTypes: true })) {
          const file = path.join(dir, item.name);
          if (item.isDirectory()) await walk(file);
          else if (item.isFile() && file.endsWith('.png')) pngs.push(file);
        }
      };
      await walk(local);
      try {
        const result = JSON.parse(await fs.readFile(path.join(local, 'result.json'), 'utf8'));
        view.summary = result.steps
          .map(
            (s) =>
              `Шаг ${s.step}: приёмка ${verdicts[s.result.verdict]}${
                s.result.checks.some((c) => c.status === 'failed')
                  ? `; провалены: ${s.result.checks
                      .filter((c) => c.status === 'failed')
                      .map((c) => c.name)
                      .join(', ')}`
                  : ''
              }`,
          )
          .join('\n');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  return { view, local, pngs: pngs.sort(), gameShots: [] };
}
export async function cancelDeclaration(id) {
  const result = await requestTarget(await target(), { method: 'POST', path: `/jobs/${id}/cancel` });
  return { state: result.job.cancelRequested && result.job.state === 'running' ? 'cancelling' : result.job.state };
}
export const listDeclarations = async () => requestTarget(await target(), { path: '/jobs' });
export async function logDeclaration(id, { step, source = 'wrapper', tail = 80, grep = null } = {}) {
  const query = new URLSearchParams({
    tail: String(tail),
    stream: source === 'latest' ? 'latest' : source === 'client' ? 'stdout' : step ? 'stdout' : 'events',
  });
  if (step) query.set('step', step);
  const result = await requestTarget(await target(), { path: `/jobs/${id}/log?${query}` });
  const lines = grep ? result.lines.filter((line) => new RegExp(grep, 'i').test(line)) : result.lines;
  return { ...result, source, total: lines.length, lines };
}
export function declarationText({ view, local }) {
  const job = view.job;
  return [
    `Задание ${job.id}: ${states[job.state] ?? job.state}; приёмка: ${verdicts[job.verdict] ?? 'ещё не завершена'}.`,
    `Закреплённое задание: SHA256 ${job.ref.sha256}.`,
    ...(job.stage ? [`Этап: ${job.stage}.`] : []),
    ...(job.state === 'queued' ? [`Место в очереди: ${view.position}.`] : []),
    ...(job.error ? [`Причина: ${job.error}`] : []),
    ...(view.summary ? [view.summary] : []),
    ...view.events.map((event) => `  ${event.seq}: ${event.stage}${event.step ? ` (${event.step})` : ''}`),
    ...(view.reason !== 'final'
      ? [`Ожидание: ${view.reason}. Продолжить: stand_wait id=${job.id} since=${view.seq}.`]
      : []),
    ...(local ? [`Результаты по шагам, паспорт и журналы: ${local}`] : []),
  ].join('\n');
}
export function declarationsText(result) {
  return [
    `Самостоятельный worker ${result.identity.version}; SHA256 ${result.identity.sha256}.`,
    result.current ? `Идёт ${result.current}.` : 'Стенд свободен.',
    ...result.jobs.map(
      (job) => `${job.id} ${states[job.state] ?? job.state} ${verdicts[job.verdict] ?? ''} — ${job.note}`,
    ),
  ].join('\n');
}
