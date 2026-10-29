/** Ограниченный разбор структуры перед публикацией: без зависимостей и без распаковки сверх лимита. */
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const SCHEMATIC_MAX = 10 * 1024 ** 2;
export function inspectSchematic(input) {
  if (!input.length || input.length > SCHEMATIC_MAX) throw new Error('Схема должна быть от 1 байта до 10 МБ');
  const bytes = Buffer.from(input);
  const raw = bytes[0] === 31 && bytes[1] === 139 ? gunzipSync(bytes, { maxOutputLength: 32 * 1024 ** 2 }) : bytes;
  let pos = 0;
  let tags = 0;
  const take = (n) => {
    if (!Number.isInteger(n) || n < 0 || pos + n > raw.length) throw new Error('Оборванный NBT');
    const start = pos;
    pos += n;
    return start;
  };
  const u8 = () => raw.readUInt8(take(1));
  const i32 = () => raw.readInt32BE(take(4));
  const str = () => {
    const n = raw.readUInt16BE(take(2));
    return raw.toString('utf8', take(n), pos);
  };
  function value(type, depth = 0) {
    if (++tags > 2_000_000 || depth > 64) throw new Error('NBT слишком сложный');
    if (type === 1) return raw.readInt8(take(1));
    if (type === 2) return raw.readInt16BE(take(2));
    if (type === 3) return i32();
    if ([4, 5, 6].includes(type)) {
      take(type === 5 ? 4 : 8);
      return null;
    }
    if (type === 8) return str();
    if ([7, 11, 12].includes(type)) {
      const n = i32();
      take(n * (type === 7 ? 1 : type === 11 ? 4 : 8));
      return null;
    }
    if (type === 9) {
      const element = u8();
      const n = i32();
      if (n < 0 || n > 1_000_000 || (n && !element)) throw new Error('Неверный список NBT');
      return Array.from({ length: n }, () => value(element, depth + 1));
    }
    if (type === 10) {
      const out = Object.create(null);
      for (;;) {
        const t = u8();
        if (!t) return out;
        const key = str();
        if (Object.hasOwn(out, key)) throw new Error('Повторный ключ NBT');
        out[key] = value(t, depth + 1);
      }
    }
    throw new Error(`Неверный тип NBT: ${type}`);
  }
  if (u8() !== 10) throw new Error('Корень NBT должен быть compound');
  str();
  const root = value(10);
  if (pos !== raw.length) throw new Error('Лишние данные после NBT');
  const size = root.size;
  if (!Array.isArray(size) || size.length !== 3 || size.some((n) => !Number.isInteger(n) || n <= 0 || n > 32768))
    throw new Error('Нет корректных габаритов схемы');
  const palettes = root.palette ? [root.palette] : root.palettes;
  if (
    !Array.isArray(palettes) ||
    !palettes.length ||
    palettes.some(
      (p) =>
        !Array.isArray(p) ||
        !p.length ||
        p.some((e) => typeof e?.Name !== 'string' || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(e.Name)),
    )
  )
    throw new Error('Нет корректной палитры блоков');
  if (!Array.isArray(root.blocks)) throw new Error('Нет списка блоков');
  for (const b of root.blocks) {
    if (
      !Number.isInteger(b?.state) ||
      b.state < 0 ||
      palettes.some((p) => b.state >= p.length) ||
      !Array.isArray(b.pos) ||
      b.pos.length !== 3 ||
      b.pos.some((v, i) => !Number.isInteger(v) || v < 0 || v >= size[i])
    )
      throw new Error('Неверная позиция или палитра блока');
  }
  return {
    size,
    blocks: root.blocks.length,
    contentHash: createHash('sha256').update(raw).digest('hex'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
