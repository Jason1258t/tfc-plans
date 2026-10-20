/**
 * Версия программы. В собранный файл (npm run tfc:dist) её вписывает esbuild: __TFC_BUILD__ —
 * { version, time } последнего коммита в cli/. Из папки проекта (node cli/tfc.mjs) версии нет — это «из исходников».
 */
/* global __TFC_BUILD__ */
export const BUILD = typeof __TFC_BUILD__ !== 'undefined' ? __TFC_BUILD__ : null;

/** Запущен ли tfc одним файлом (Node SEA), а не node cli/tfc.mjs */
export const IS_BINARY = BUILD !== null;

/** Имя файла сборки для этой системы — как в dist-tfc/ и на сайте */
export function targetName(platform = process.platform, arch = process.arch) {
  const os = { win32: 'win', darwin: 'macos', linux: 'linux' }[platform];
  return os ? `${os}-${arch}` : null;
}
