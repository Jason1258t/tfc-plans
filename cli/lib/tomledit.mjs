/**
 * Точечная правка TOML-конфига (tfc admin changes): меняется только значение ключа, комментарии, порядок и отступы
 * остаются как были. Конфиги NeoForge — таблицы [a.b] и строки «ключ = значение»; многострочные строки ("""…""")
 * не поддерживаются — такой ключ не правим. Ключ — полное имя через точки, как в config_get (blocks.crops.x).
 */

/** Части ключа: bare.key."quoted key" → ['bare', 'key', 'quoted key']; null — не ключ */
function keyParts(s) {
  const out = [];
  let i = 0;
  const ws = () => {
    while (s[i] === ' ' || s[i] === '\t') i++;
  };
  for (;;) {
    ws();
    let m;
    if (s[i] === '"' && (m = /^"((?:[^"\\]|\\.)*)"/.exec(s.slice(i)))) {
      out.push(JSON.parse(m[0]));
      i += m[0].length;
    } else if (s[i] === "'" && (m = /^'([^']*)'/.exec(s.slice(i)))) {
      out.push(m[1]);
      i += m[0].length;
    } else if ((m = /^[A-Za-z0-9_-]+/.exec(s.slice(i)))) {
      out.push(m[0]);
      i += m[0].length;
    } else return null;
    ws();
    if (s[i] !== '.') return { parts: out, end: i };
    i++;
  }
}

/** Конец значения с позиции i: учитывает строки и вложенные [ ] / { } (массив на несколько строк) */
function valueEnd(text, i) {
  let depth = 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      if (text.startsWith(c.repeat(3), i)) throw new Error('многострочные строки не поддерживаются');
      const close = c === '"' ? /^"(?:[^"\\\n]|\\.)*"/ : /^'[^'\n]*'/;
      const m = close.exec(text.slice(i));
      if (!m) throw new Error('незакрытая строка');
      i += m[0].length - 1;
    } else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === '#' || c === '\n' || c === '\r') {
      if (depth === 0) return i;
      if (c === '#') while (i < text.length && text[i] !== '\n') i++;
    }
  }
  return i;
}

/** Строки файла с ключами: [{ key, valueStart, valueEnd, raw, lineStart, indent, table }] и заголовки таблиц */
export function tomlScan(text) {
  const keys = [];
  const tables = [];
  let table = '';
  let pos = 0;
  while (pos < text.length) {
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl < 0 ? text.length : nl;
    const line = text.slice(pos, lineEnd).replace(/\r$/, '');
    const indent = /^[ \t]*/.exec(line)[0];
    const body = line.slice(indent.length);
    let next = nl < 0 ? text.length : nl + 1;
    if (body.startsWith('[')) {
      const arr = body.startsWith('[[');
      const k = keyParts(body.slice(arr ? 2 : 1));
      if (k) {
        table = k.parts.join('.');
        tables.push({ table, lineStart: pos, indent });
      }
    } else if (body && !body.startsWith('#')) {
      const k = keyParts(body);
      if (k && body[k.end] === '=') {
        let vs = pos + indent.length + k.end + 1;
        while (text[vs] === ' ' || text[vs] === '\t') vs++;
        const ve = valueEnd(text, vs);
        let raw = text.slice(vs, ve).trimEnd();
        keys.push({
          key: [table, ...k.parts].filter(Boolean).join('.'),
          valueStart: vs,
          valueEnd: vs + raw.length,
          raw,
          lineStart: pos,
          indent,
          table,
        });
        const after = text.indexOf('\n', ve);
        if (ve > lineEnd) next = after < 0 ? text.length : after + 1;
      }
    }
    pos = next;
  }
  return { keys, tables };
}

/** Значение TOML → JS (числа, true/false, строки, массивы, встроенные таблицы); undefined — не разобрали */
export function tomlValue(raw) {
  let i = 0;
  const s = raw;
  const ws = () => {
    while (i < s.length) {
      if (/\s/.test(s[i])) i++;
      else if (s[i] === '#') while (i < s.length && s[i] !== '\n') i++;
      else break;
    }
  };
  function val() {
    ws();
    let m;
    const rest = s.slice(i);
    if ((m = /^"(?:[^"\\\n]|\\.)*"/.exec(rest))) {
      i += m[0].length;
      return JSON.parse(m[0]);
    }
    if ((m = /^'([^'\n]*)'/.exec(rest))) {
      i += m[0].length;
      return m[1];
    }
    if ((m = /^(true|false)\b/.exec(rest))) {
      i += m[0].length;
      return m[0] === 'true';
    }
    if ((m = /^[+-]?(inf|nan)\b/.exec(rest))) {
      i += m[0].length;
      return m[1] === 'nan' ? NaN : m[0].startsWith('-') ? -Infinity : Infinity;
    }
    if ((m = /^[+-]?\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?/.exec(rest))) {
      i += m[0].length;
      return Number(m[0].replaceAll('_', ''));
    }
    if (s[i] === '[') {
      i++;
      const out = [];
      for (;;) {
        ws();
        if (s[i] === ']') {
          i++;
          return out;
        }
        out.push(val());
        ws();
        if (s[i] === ',') i++;
        else if (s[i] !== ']') throw new Error('массив');
      }
    }
    if (s[i] === '{') {
      i++;
      const out = {};
      for (;;) {
        ws();
        if (s[i] === '}') {
          i++;
          return out;
        }
        const k = keyParts(s.slice(i));
        if (!k || s[i + k.end] !== '=') throw new Error('таблица');
        i += k.end + 1;
        out[k.parts.join('.')] = val();
        ws();
        if (s[i] === ',') i++;
      }
    }
    throw new Error('значение');
  }
  try {
    const v = val();
    ws();
    return i === s.length ? v : undefined;
  } catch {
    return undefined;
  }
}

const isFloatRaw = (raw) => /^[+-]?\d[\d_]*(\.\d|[eE])/.test(raw);

/** JS → текст TOML; like — прежний текст значения: дробное в файле (1.0) остаётся дробным (5.0) */
export function tomlFormat(v, like = '') {
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('число должно быть конечным');
    if (Number.isInteger(v)) {
      if (isFloatRaw(like)) return `${v}.0`;
      return String(v);
    }
    if (like && /^[+-]?\d[\d_]*$/.test(like)) throw new Error(`в файле целое (${like}), а предложено дробное ${v}`);
    return String(v);
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) {
    const items = tomlValue(like);
    const first = Array.isArray(items) && items.length && typeof items[0] === 'number' ? String(like) : '';
    const elemLike = first && /\[\s*[+-]?\d[\d_]*\./.test(first) ? '0.0' : '';
    return `[${v.map((x) => tomlFormat(x, typeof x === 'number' ? elemLike : '')).join(', ')}]`;
  }
  throw new Error('значение — число, true/false, строка или массив');
}

/**
 * Поставить ключ: { text, from (прежнее значение или undefined), added }. Ключа нет — дописывается в конец его
 * таблицы (или новой таблицей в конец файла), с отступом соседей и переводом строк файла.
 */
export function tomlSet(text, key, value) {
  const { keys, tables } = tomlScan(text);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const hit = keys.find((k) => k.key === key);
  if (hit) {
    const out = text.slice(0, hit.valueStart) + tomlFormat(value, hit.raw) + text.slice(hit.valueEnd);
    return { text: out, from: tomlValue(hit.raw), raw: hit.raw, added: false };
  }
  // Самая длинная таблица — начало ключа; остаток — имя в ней
  const table = tables
    .map((t) => t.table)
    .filter((t) => key.startsWith(`${t}.`))
    .sort((a, b) => b.length - a.length)[0];
  const tail = table ? key.slice(table.length + 1) : key;
  const bare = tail
    .split('.')
    .map((p) => (/^[A-Za-z0-9_-]+$/.test(p) ? p : JSON.stringify(p)))
    .join('.');
  if (table !== undefined) {
    const inTable = keys.filter((k) => k.table === table);
    const head = tables.find((t) => t.table === table);
    const last = inTable.at(-1);
    let at = last ? text.indexOf('\n', last.valueEnd) : text.indexOf('\n', head.lineStart);
    at = at < 0 ? text.length : at + 1;
    const indent = last ? last.indent : `${head.indent}\t`;
    const pre = at === text.length && !text.endsWith('\n') ? eol : '';
    const line = `${pre}${indent}${bare} = ${tomlFormat(value)}${eol}`;
    return { text: text.slice(0, at) + line + text.slice(at), from: undefined, added: true };
  }
  const parts = key.split('.');
  const name = parts.pop();
  // Ключ без таблицы — до первой таблицы, иначе TOML отнёс бы его к последней
  if (!parts.length) {
    const at = tables[0]?.lineStart ?? text.length;
    const pre = at === text.length && text && !text.endsWith('\n') ? eol : '';
    return {
      text: `${text.slice(0, at)}${pre}${bare} = ${tomlFormat(value)}${eol}${text.slice(at)}`,
      from: undefined,
      added: true,
    };
  }
  const pre = text && !text.endsWith('\n') ? eol : '';
  const block = `${pre}${eol}[${parts.join('.')}]${eol}\t${name} = ${tomlFormat(value)}${eol}`;
  return { text: text + block, from: undefined, added: true };
}
