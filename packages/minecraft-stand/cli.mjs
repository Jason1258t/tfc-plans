#!/usr/bin/env node
/** Проверка декларации до доставки на worker. Не запускает Minecraft и не обращается к сети. */
import fs from 'node:fs';
import { checkJob } from './job.mjs';
import { digest } from './passport.mjs';
try {
  const [command, file, ...extra] = process.argv.slice(2);
  if (command !== 'validate' || !file || extra.length)
    throw new Error('Использование: minecraft-stand validate <job.json>');
  const job = checkJob(JSON.parse(fs.readFileSync(file, 'utf8')));
  console.log(
    JSON.stringify({ сообщение: 'Задание корректно', id: job.id, sha256: digest(job), шагов: job.steps.length }),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
