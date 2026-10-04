/**
 * Минимальный читатель/писатель NBT (формат Minecraft) без потерь: структура и типы тегов
 * сохраняются как есть, поэтому файл после правки побайтно совпадает с исходным везде, кроме изменённых строк.
 * Схемы Create (.nbt) — это сжатый gzip NBT с палитрой блоков.
 */

export const T = {
  End: 0,
  Byte: 1,
  Short: 2,
  Int: 3,
  Long: 4,
  Float: 5,
  Double: 6,
  ByteArray: 7,
  String: 8,
  List: 9,
  Compound: 10,
  IntArray: 11,
  LongArray: 12,
} as const;
export type T = (typeof T)[keyof typeof T];

export type Tag =
  | { type: typeof T.Byte | typeof T.Short | typeof T.Int | typeof T.Float | typeof T.Double; value: number }
  | { type: typeof T.Long; value: bigint }
  | { type: typeof T.String; value: string }
  | { type: typeof T.ByteArray; value: Int8Array }
  | { type: typeof T.IntArray; value: Int32Array }
  | { type: typeof T.LongArray; value: BigInt64Array }
  | { type: typeof T.List; elemType: T; value: Tag[] }
  | { type: typeof T.Compound; value: Compound };

/** Порядок ключей сохраняется (Map), чтобы запись совпадала с оригиналом */
export type Compound = Map<string, Tag>;

export interface NbtRoot {
  name: string;
  value: Compound;
}

// ---------------------------------------------------------------- modified UTF-8 (Java)

function decodeMutf8(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length;) {
    const c = b[i++];
    if (c < 0x80) out += String.fromCharCode(c);
    else if ((c & 0xe0) === 0xc0) out += String.fromCharCode(((c & 0x1f) << 6) | (b[i++] & 0x3f));
    else out += String.fromCharCode(((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f));
  }
  return out;
}

function encodeMutf8(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i); // UTF-16 code unit: суррогаты кодируются по отдельности, как в Java
    if (c >= 1 && c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------- чтение

class Reader {
  private buf: Uint8Array;
  private view: DataView;
  pos = 0;
  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  u8() {
    return this.view.getUint8(this.pos++);
  }
  i8() {
    return this.view.getInt8(this.pos++);
  }
  i16() {
    const v = this.view.getInt16(this.pos);
    this.pos += 2;
    return v;
  }
  u16() {
    const v = this.view.getUint16(this.pos);
    this.pos += 2;
    return v;
  }
  i32() {
    const v = this.view.getInt32(this.pos);
    this.pos += 4;
    return v;
  }
  i64() {
    const v = this.view.getBigInt64(this.pos);
    this.pos += 8;
    return v;
  }
  f32() {
    const v = this.view.getFloat32(this.pos);
    this.pos += 4;
    return v;
  }
  f64() {
    const v = this.view.getFloat64(this.pos);
    this.pos += 8;
    return v;
  }
  str() {
    const len = this.u16();
    const s = decodeMutf8(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }
  payload(type: T): Tag {
    switch (type) {
      case T.Byte:
        return { type, value: this.i8() };
      case T.Short:
        return { type, value: this.i16() };
      case T.Int:
        return { type, value: this.i32() };
      case T.Long:
        return { type, value: this.i64() };
      case T.Float:
        return { type, value: this.f32() };
      case T.Double:
        return { type, value: this.f64() };
      case T.String:
        return { type, value: this.str() };
      case T.ByteArray: {
        const n = this.i32();
        const v = new Int8Array(n);
        for (let i = 0; i < n; i++) v[i] = this.i8();
        return { type, value: v };
      }
      case T.IntArray: {
        const n = this.i32();
        const v = new Int32Array(n);
        for (let i = 0; i < n; i++) v[i] = this.i32();
        return { type, value: v };
      }
      case T.LongArray: {
        const n = this.i32();
        const v = new BigInt64Array(n);
        for (let i = 0; i < n; i++) v[i] = this.i64();
        return { type, value: v };
      }
      case T.List: {
        const elemType = this.u8() as T;
        const n = this.i32();
        const value: Tag[] = [];
        for (let i = 0; i < n; i++) value.push(this.payload(elemType));
        return { type, elemType, value };
      }
      case T.Compound: {
        const value: Compound = new Map();
        for (;;) {
          const t = this.u8() as T;
          if (t === T.End) break;
          const name = this.str();
          value.set(name, this.payload(t));
        }
        return { type, value };
      }
      default:
        throw new Error(`Неизвестный тип NBT-тега ${type} на позиции ${this.pos}`);
    }
  }
}

// ---------------------------------------------------------------- запись

class Writer {
  private buf = new Uint8Array(1 << 16);
  private view = new DataView(this.buf.buffer);
  pos = 0;
  private ensure(n: number) {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number) {
    this.ensure(1);
    this.view.setUint8(this.pos++, v);
  }
  i8(v: number) {
    this.ensure(1);
    this.view.setInt8(this.pos++, v);
  }
  i16(v: number) {
    this.ensure(2);
    this.view.setInt16(this.pos, v);
    this.pos += 2;
  }
  u16(v: number) {
    this.ensure(2);
    this.view.setUint16(this.pos, v);
    this.pos += 2;
  }
  i32(v: number) {
    this.ensure(4);
    this.view.setInt32(this.pos, v);
    this.pos += 4;
  }
  i64(v: bigint) {
    this.ensure(8);
    this.view.setBigInt64(this.pos, v);
    this.pos += 8;
  }
  f32(v: number) {
    this.ensure(4);
    this.view.setFloat32(this.pos, v);
    this.pos += 4;
  }
  f64(v: number) {
    this.ensure(8);
    this.view.setFloat64(this.pos, v);
    this.pos += 8;
  }
  str(s: string) {
    const b = encodeMutf8(s);
    if (b.length > 0xffff) throw new Error('Строка NBT длиннее 65535 байт');
    this.u16(b.length);
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }
  payload(tag: Tag) {
    switch (tag.type) {
      case T.Byte:
        return this.i8(tag.value);
      case T.Short:
        return this.i16(tag.value);
      case T.Int:
        return this.i32(tag.value);
      case T.Long:
        return this.i64(tag.value);
      case T.Float:
        return this.f32(tag.value);
      case T.Double:
        return this.f64(tag.value);
      case T.String:
        return this.str(tag.value);
      case T.ByteArray:
        this.i32(tag.value.length);
        for (const v of tag.value) this.i8(v);
        return;
      case T.IntArray:
        this.i32(tag.value.length);
        for (const v of tag.value) this.i32(v);
        return;
      case T.LongArray:
        this.i32(tag.value.length);
        for (const v of tag.value) this.i64(v);
        return;
      case T.List:
        this.u8(tag.elemType);
        this.i32(tag.value.length);
        for (const v of tag.value) this.payload(v);
        return;
      case T.Compound:
        for (const [name, v] of tag.value) {
          this.u8(v.type);
          this.str(name);
          this.payload(v);
        }
        this.u8(T.End);
        return;
    }
  }
  result() {
    return this.buf.slice(0, this.pos);
  }
}

// ---------------------------------------------------------------- gzip + API

const isGzip = (b: Uint8Array) => b[0] === 0x1f && b[1] === 0x8b;

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export interface ParsedNbt {
  root: NbtRoot;
  gzipped: boolean;
}

export async function readNbt(input: Uint8Array): Promise<ParsedNbt> {
  const gzipped = isGzip(input);
  const raw = gzipped ? await pipe(input, new DecompressionStream('gzip')) : input;
  const r = new Reader(raw);
  const type = r.u8();
  if (type !== T.Compound) throw new Error('Это не NBT-файл: корень не compound');
  const name = r.str();
  const root = r.payload(T.Compound) as { type: typeof T.Compound; value: Compound };
  return { root: { name, value: root.value }, gzipped };
}

export function writeNbtRaw(root: NbtRoot): Uint8Array {
  const w = new Writer();
  w.u8(T.Compound);
  w.str(root.name);
  w.payload({ type: T.Compound, value: root.value });
  return w.result();
}

export async function writeNbt(root: NbtRoot, gzip: boolean): Promise<Uint8Array> {
  const raw = writeNbtRaw(root);
  return gzip ? pipe(raw, new CompressionStream('gzip')) : raw;
}
