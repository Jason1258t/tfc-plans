#!/usr/bin/env node
/**
 * Ключи прямо на сервере, без HTTP — для первого ключа администратора (его создаёт install.sh)
 * и на случай, если ключ администратора потерян. Остальное — через API (/admin/keys).
 *
 *   node cli.mjs key add <имя> [--role admin|player]
 *   node cli.mjs key list
 *   node cli.mjs key revoke <id>
 *
 * Папка данных — DATA_DIR (как у сервера). Работающий сервер подхватывает изменения сам.
 */
import { openKeys } from './lib/keys.mjs';

const [cmd, sub, ...rest] = process.argv.slice(2);
const keys = openKeys(process.env.DATA_DIR ?? './data');
const flag = (name, def) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest.splice(i, 2)[1] : def;
};

try {
  if (cmd === 'key' && sub === 'add') {
    const role = flag('--role', 'player');
    const k = await keys.add(rest.join(' '), role, 'cli');
    console.log(`Ключ «${k.name}» (${k.role}), id ${k.id}. Сохраните его — больше он нигде не показывается:\n${k.key}`);
  } else if (cmd === 'key' && sub === 'list') {
    for (const k of await keys.list())
      console.log(`${k.id}  ${k.role.padEnd(6)}  ${k.name}  (${k.createdAt}, выдал ${k.createdBy})`);
  } else if (cmd === 'key' && sub === 'revoke') {
    const k = await keys.revoke(rest[0]);
    console.log(`Отозван ключ «${k.name}» (${k.role})`);
  } else {
    console.log('node cli.mjs key add <имя> [--role admin|player] | key list | key revoke <id>');
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
