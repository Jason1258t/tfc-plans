/** Переносимые пути входов; каталог прогона никогда не содержит ссылок на кеш. */
import path from 'node:path';
export function relativeFile(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\\') ||
    [...value].some((char) => char.charCodeAt(0) < 32) ||
    path.posix.isAbsolute(value) ||
    /^[a-z]:/i.test(value) ||
    value.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw new Error(`Недопустимый путь артефакта: ${value}`);
  return value;
}
