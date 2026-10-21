/**
 * PNG без зависимостей (node:zlib): карты профилей TFC Real World — серые, палитра (Кёппен), 1-битная маска суши.
 * Отдаёт по пикселю: v — значение канала как в растре (Raster.getSample, без цветового пространства),
 * rgb — 0xRRGGBB (для палитры — цвет из PLTE), a — прозрачность 0…255 (альфа-канал или tRNS).
 * Чересстрочные PNG не поддерживаются (в моде их нет). encodePng — RGBA 8 бит (картинки model_render, texture_get).
 */
import zlib from 'node:zlib';

const SIG = '89504e470d0a1a0a';

export function decodePng(buf) {
  if (buf.subarray(0, 8).toString('hex') !== SIG) throw new Error('не PNG');
  let w = 0;
  let h = 0;
  let depth = 0;
  let type = 0;
  let palette = null;
  let trns = null;
  const idat = [];
  for (let i = 8; i < buf.length;) {
    const len = buf.readUInt32BE(i);
    const kind = buf.toString('latin1', i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + len);
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      type = data[9];
      if (data[12]) throw new Error('чересстрочный PNG не поддерживается');
    } else if (kind === 'PLTE') palette = data;
    else if (kind === 'tRNS') trns = data;
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    i += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`тип цвета PNG ${type} не поддерживается`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = Math.max(1, (channels * depth) >> 3);
  const stride = Math.ceil((w * channels * depth) / 8);
  const rows = Buffer.alloc(stride * h);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = rows.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let p = src[x];
      if (f === 1) p += a;
      else if (f === 2) p += b;
      else if (f === 3) p += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        p += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = p & 255;
    }
    prev = out;
  }
  // Значение канала c пикселя x строки y (16 бит — старший байт)
  const sample = (y, x, c) => {
    const row = y * stride;
    if (depth === 8) return rows[row + x * channels + c];
    if (depth === 16) return rows[row + (x * channels + c) * 2];
    const bit = (x * channels + c) * depth;
    return (rows[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  const n = w * h;
  const v = new Uint8Array(n);
  const rgb = new Int32Array(n);
  const alpha = new Uint8Array(n).fill(255);
  const max = depth === 16 ? 255 : (1 << depth) - 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (type === 3) {
        const k = sample(y, x, 0);
        v[i] = k;
        rgb[i] = palette ? (palette[k * 3] << 16) | (palette[k * 3 + 1] << 8) | palette[k * 3 + 2] : 0;
        if (trns && k < trns.length) alpha[i] = trns[k];
      } else if (type === 0 || type === 4) {
        const g = Math.round((sample(y, x, 0) * 255) / max);
        v[i] = g;
        rgb[i] = (g << 16) | (g << 8) | g;
        if (type === 4) alpha[i] = sample(y, x, 1);
      } else {
        const r = sample(y, x, 0);
        const g = sample(y, x, 1);
        const b = sample(y, x, 2);
        v[i] = r;
        rgb[i] = (r << 16) | (g << 8) | b;
        if (type === 6) alpha[i] = sample(y, x, 3);
      }
    }
  return { width: w, height: h, type, depth, v, rgb, a: alpha };
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(kind, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(kind, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
}

/** PNG из RGBA (Uint8Array w*h*4) */
export function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from(SIG, 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
