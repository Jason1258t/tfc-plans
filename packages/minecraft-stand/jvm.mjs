/** Универсальный JVM backend; конкретный загрузчик и обходы модов задаются отдельными адаптерами. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { relativeFile } from './files.mjs';
import { runProcess } from './process.mjs';
const stringArray = (values, label) => {
  if (!Array.isArray(values) || values.some((v) => typeof v !== 'string' || v.includes('\0')))
    throw new Error(`${label}: нужен массив строк`);
};
export const jvmBackend = {
  kinds: ['client', 'server'],
  artifacts: { logs: 'logs', world: 'world', frames: 'screenshots' },
  validate(step) {
    stringArray(step.launch?.args, 'launch.args');
    stringArray(step.launch?.jvmArgs ?? [], 'launch.jvmArgs');
    if (step.launch?.java) relativeFile(step.launch.java);
    if ([...step.launch.args, ...(step.launch.jvmArgs ?? [])].some((arg) => /^-Xm[xs]/.test(arg)))
      throw new Error('Размер heap задаётся resources.memoryMiB, не флагами launch');
  },
  async run({ step, game, java, output, signal, scenario, resources }) {
    const executable = path.join(java, relativeFile(step.launch.java ?? 'bin/java'));
    if (!(await fs.lstat(executable)).isFile()) throw new Error('Нет закреплённого исполняемого файла Java');
    const replacements = { game, java, memoryMiB: String(resources.memoryMiB) };
    const expand = (value) =>
      value.replace(/\$\{([^}]+)\}/g, (match, name) => {
        if (!Object.hasOwn(replacements, name)) throw new Error(`Неизвестная подстановка ${match}`);
        return replacements[name];
      });
    if (scenario) {
      if (
        scenario.readyText !== undefined &&
        (typeof scenario.readyText !== 'string' || !scenario.readyText || scenario.readyText.length > 65536)
      )
        throw new Error('scenario.readyText: нужна непустая строка');
      stringArray(scenario.commands ?? [], 'scenario.commands');
      if ((scenario.commands?.length || scenario.stopCommand || scenario.stopAfterReady) && !scenario.readyText)
        throw new Error('Сценарий команд требует readyText');
      if (scenario.stopCommand !== undefined && (typeof scenario.stopCommand !== 'string' || !scenario.stopCommand))
        throw new Error('scenario.stopCommand: нужна строка');
      if (scenario.holdSeconds !== undefined && (!Number.isFinite(scenario.holdSeconds) || scenario.holdSeconds < 0))
        throw new Error('scenario.holdSeconds: нужно неотрицательное число');
    }
    await fs.mkdir(path.join(game, '.home'), { recursive: true });
    return runProcess({
      executable,
      args: [
        `-Xmx${resources.memoryMiB}M`,
        ...(step.launch.jvmArgs ?? []).map(expand),
        ...step.launch.args.map(expand),
      ],
      cwd: game,
      // Никаких ключей/адресов TFC из окружения установленной службы.
      env: { HOME: path.join(game, '.home'), JAVA_HOME: java, PATH: path.join(java, 'bin'), LANG: 'C.UTF-8' },
      signal,
      output,
      scenario: scenario ?? {},
    });
  },
};
