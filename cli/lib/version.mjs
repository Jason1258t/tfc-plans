/**
 * Версия программы. В собранный файл и пакет npm (npm run tfc:dist) её вписывает esbuild: __TFC_BUILD__ —
 * { version, time, release, build, channel }: version — метка последнего коммита программы (дата-хеш), release —
 * читаемая версия из cli/package.json (повышают по правилу в docs/tfc-app.md), build — номер сборки, число коммитов
 * программы (растёт сам). Из папки проекта (node cli/tfc.mjs) версии нет — это «из исходников».
 */
/* global __TFC_BUILD__ */
export const BUILD = typeof __TFC_BUILD__ !== 'undefined' ? __TFC_BUILD__ : null;

/** Как поставлен tfc: 'binary' — один файл (Node SEA), 'npm' — пакет npm, 'source' — node cli/tfc.mjs из проекта */
export const CHANNEL = BUILD ? (BUILD.channel ?? 'binary') : 'source';

/** Запущен ли tfc одним файлом (Node SEA), а не через Node */
export const IS_BINARY = CHANNEL === 'binary';

/** Имя файла сборки для этой системы — как в dist-tfc/ и на сайте */
export function targetName(platform = process.platform, arch = process.arch) {
  const os = { win32: 'win', darwin: 'macos', linux: 'linux' }[platform];
  return os ? `${os}-${arch}` : null;
}

/** Как показывать версию: «1.2.0 (сборка 74)»; full — ещё и метка коммита. Старые version.json — только метка */
export function versionLabel(b, { full = false } = {}) {
  if (!b) return '';
  if (!b.release) return b.version;
  const extra = [b.build != null && `сборка ${b.build}`, full && b.version].filter(Boolean).join(', ');
  return extra ? `${b.release} (${extra})` : b.release;
}
