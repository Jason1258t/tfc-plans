/**
 * Вывод в терминал: вопросы, выбор из списка, полоса загрузки, размеры.
 */
import readline from 'node:readline/promises';

const tty = process.stdout.isTTY;
export const color = (code) => (s) => (tty && !process.env.NO_COLOR ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const bold = color(1);
export const dim = color(2);
export const green = color(32);
export const yellow = color(33);
export const red = color(31);
export const cyan = color(36);

export function mb(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  return `${(bytes / 1024 ** 3).toFixed(2)} ГБ`;
}

export const date = (ms) =>
  new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Можно ли спрашивать: терминал и не --yes */
export const interactive = () => process.stdin.isTTY && process.stdout.isTTY;

export async function ask(question, def = '') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = (await rl.question(`${question}${def ? dim(` [${def}]`) : ''}: `)).trim();
    return a || def;
  } finally {
    rl.close();
  }
}

export async function confirm(question, def = false) {
  if (!interactive()) return def;
  const a = (await ask(`${question} ${dim(def ? '(Д/н)' : '(д/Н)')}`)).toLowerCase();
  if (!a) return def;
  return ['д', 'да', 'y', 'yes', 'l'].includes(a);
}

/** Выбор из списка: номер или свой ввод (если allowOther). Возвращает элемент или строку */
export async function choose(question, items, label, { allowOther = false } = {}) {
  items.forEach((it, i) => console.log(`  ${cyan(i + 1)}. ${label(it)}`));
  for (;;) {
    const a = await ask(allowOther ? `${question} (номер или путь)` : `${question} (номер)`, items.length ? '1' : '');
    const n = Number(a);
    if (Number.isInteger(n) && n >= 1 && n <= items.length) return items[n - 1];
    if (allowOther && a) return a;
    console.log(red('  нет такого варианта'));
  }
}

/** Полоса загрузки: одна строка, обновляется на месте (в файл/пайп — только итог) */
export function progress(title, total) {
  let done = 0;
  let last = 0;
  const draw = (force) => {
    const now = Date.now();
    if (!tty || (!force && now - last < 100)) return;
    last = now;
    const pct = total ? Math.min(100, Math.floor((done / total) * 100)) : 100;
    const w = 24;
    const bar = '█'.repeat(Math.round((pct / 100) * w)).padEnd(w, '░');
    process.stdout.write(`\r  ${title} ${bar} ${pct}% ${dim(`${mb(done)} из ${mb(total)}`)}   `);
  };
  return {
    add(n) {
      done += n;
      draw(false);
    },
    end() {
      done = total;
      draw(true);
      if (tty) process.stdout.write('\n');
      else console.log(`  ${title}: ${mb(total)}`);
    },
  };
}
