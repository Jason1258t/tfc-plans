/**
 * «Шум» в файлах сборки: игра и моды переписывают файлы, не меняя настроек. По истории снимков на сервере сборки
 * (docs/pack-server.md, «Шум»):
 * - .properties (Java Properties.store) — первая строка-комментарий с датой сохранения, при каждом запуске новая;
 * - некоторые моды при каждом запуске дописывают пустые строки (coldsweat_altitude-server.toml: 554 → 598 строк);
 * - календарь мира TFC — текущее время мира; сайту из него нужна только длина месяца.
 * Ключ смысла — хеш содержимого без этого шума: равные ключи — файл по сути тот же.
 */
import { createHash } from 'node:crypto';
import { readNbt, T } from '../../src/lib/nbt.ts';

/** Текстовые конфиги, у которых сравниваем смысл, а не байты */
const TEXT = /^(config|defaultconfigs|serverconfig)\/.*\.(toml|json5?|cfg|properties|txt|snbt|ya?ml|ini)$/i;
/** Больше — не разбираем (сравнение по байтам, как раньше) */
const MAX_TEXT = 4 * 1024 * 1024;
/** Дата, которую Java пишет в шапку .properties: #Wed Oct 21 19:39:53 MSK 2026 */
const DATE_LINE = /^#(Mon|Tue|Wed|Thu|Fri|Sat|Sun) [A-Z][a-z]{2} [ \d]?\d \d\d:\d\d:\d\d [\w+-]+ \d{4}$/;

export const CALENDAR = 'world/data/tfc_calendar.dat';
/** Идущее время мира в календаре TFC; остальное (daysInMonth, calendarTickRate) — настройки */
const CALENDAR_TIME = new Set(['calendarTime', 'calendarPartialTick', 'playerTime', 'arePlayersLoggedOn']);

const sha1 = (s) => createHash('sha1').update(s).digest('hex');

export const isTextConfig = (p) => TEXT.test(p);

/** Ключ смысла текстового конфига (синхронно) или null — файл не текстовый конфиг или слишком большой */
export function textKey(p, buf) {
  if (!isTextConfig(p) || buf.length > MAX_TEXT) return null;
  const lines = Buffer.from(buf)
    .toString('utf8')
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l && !DATE_LINE.test(l));
  return sha1(lines.join('\n'));
}

/** NBT → JSON без полей времени */
function plain(tag) {
  switch (tag.type) {
    case T.Compound: {
      const o = {};
      for (const [k, v] of tag.value) if (!CALENDAR_TIME.has(k)) o[k] = plain(v);
      return o;
    }
    case T.List:
      return tag.value.map(plain);
    case T.Long:
      return String(tag.value);
    case T.ByteArray:
    case T.IntArray:
    case T.LongArray:
      return Array.from(tag.value, String);
    default:
      return tag.value;
  }
}

/** Ключ смысла любого файла сборки (null — сравнивать по байтам) */
export async function meaningKey(p, buf) {
  if (p === CALENDAR) {
    try {
      const { root } = await readNbt(new Uint8Array(buf));
      return sha1(JSON.stringify(plain({ type: T.Compound, value: root.value })));
    } catch {
      return null;
    }
  }
  return textKey(p, buf);
}

/** Есть ли у пути сравнение по смыслу */
export const hasMeaning = (p) => p === CALENDAR || isTextConfig(p);
