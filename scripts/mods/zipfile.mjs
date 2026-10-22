/**
 * Jar для разборщиков с тем же набором вызовов, что у AdmZip (getEntries, getEntry, entryName, getData), но без
 * чтения архива в память целиком: оглавление — из центрального каталога, запись — по смещению при getData
 * (scripts/mcp/jars.mjs). AdmZip держал бы весь jar в памяти, пока жив объект: правила видимости открывают все jar
 * сборки сразу, мультиблоки держат jar IE до конца — сборка на сервере сборки (куча 640 МБ) не влезала.
 * src — путь к jar или Buffer (вложенный jar).
 */
import { zipEntries, zipRead } from '../mcp/jars.mjs';

export function openJar(src) {
  const entries = zipEntries(src).map((e) => ({
    entryName: e.name,
    isDirectory: e.name.endsWith('/'),
    getData: () => zipRead(src, e),
  }));
  const byName = new Map(entries.map((e) => [e.entryName, e]));
  return { getEntries: () => entries, getEntry: (name) => byName.get(name) ?? null };
}
