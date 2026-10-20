/**
 * Инструмент MCP: разбор лога или краш-репорта игры/сервера (latest.log, debug.log, crash-reports/*.txt, .gz).
 * Стек → jar и мод по индексу классов сборки, обработчики миксинов в стеке → мод, частые ошибки (нет метода,
 * нет класса, миксин не применился, не хватает зависимости, битый рецепт/скрипт KubeJS) — с пояснением.
 * Адреса игроков (/1.2.3.4:5678) в ответ не попадают.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { javaName, methodShort } from '../bytecode.mjs';
import { classIndex, classRecord, isRuntimeClass, jarMeta, jarOwner, readClass } from '../code-index.mjs';
import { clip, page, paging, short, str } from '../fmt.mjs';
import { PLATFORM } from '../jars.mjs';

const maskIp = (s) => s.replace(/\/\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?/g, '/<ip>');
const modOf = (jar) => (jar === PLATFORM ? 'minecraft' : jarOwner(jar));

function readInput(a) {
  if (a.text) return { name: 'текст', text: String(a.text) };
  if (!a.path) throw new Error('нужен path (файл, .gz или папка игры/сервера) или text');
  let p = path.resolve(String(a.path));
  if (!fs.existsSync(p)) throw new Error(`нет ${p}`);
  let others = [];
  if (fs.statSync(p).isDirectory()) {
    // Папка игры: самый свежий краш-репорт или latest.log
    const cands = [];
    for (const sub of ['crash-reports', 'logs', '.'])
      for (const f of fs.existsSync(path.join(p, sub)) ? fs.readdirSync(path.join(p, sub)) : [])
        if (/^crash-.*\.txt$|^latest\.log$|^debug\.log$/.test(f)) {
          const full = path.join(p, sub, f);
          cands.push({ full, mtime: fs.statSync(full).mtimeMs });
        }
    if (!cands.length) throw new Error(`в ${p} нет crash-reports/*.txt и logs/latest.log`);
    cands.sort((x, y) => y.mtime - x.mtime);
    const pick = cands.find((c) => !c.full.endsWith('debug.log')) ?? cands[0];
    others = cands
      .filter((c) => c !== pick)
      .slice(0, 5)
      .map((c) => path.relative(p, c.full));
    p = pick.full;
  }
  let buf = fs.readFileSync(p);
  if (p.endsWith('.gz')) buf = zlib.gunzipSync(buf);
  return { name: p, text: buf.toString('utf8'), others };
}

// ---------------------------------------------------------------- стек

// Кадр: «at [TRANSFORMER/мод@версия/|java.base/]класс.метод(Файл.java:N) ~[jar%23N!/:?] {re:mixin,…}»
const FRAME = /^\s*at\s+(?:[\w.@+-]*\/)*([\w.$]+)\.([\w$<>]+)\(([^)]*)\)\s*(?:~?\[([^\]]*)\])?\s*(?:\{([^}]*)\})?/;
const EXC =
  /^\s*(?:Caused by: |Exception in thread "[^"]*" |Suppressed: )?((?:[a-z_][\w$]*\.)+[A-Z][\w$]*(?:Exception|Error|Throwable|Failure|Exception\$\w+))(?::\s?(.*))?$/;
/** Обработчик миксина в стеке: handler$zza000$[modid$]name, redirect$…, wrapOperation$… (имя может содержать $) */
const HANDLER =
  /^(handler|redirect|modify|localvar|constant|args|wrapOperation|wrapWithCondition|modifyExpressionValue|modifyReturnValue|modifyReceiver|wrapMethod|md[a-z0-9]*|mixinextras[\w]*)\$([a-z]{3}\d{3})\$(.+)$/;

/** { kind, mod|null, name }: id мода — если первая часть после номера совпадает с модом сборки */
function parseHandler(method) {
  const h = method.match(HANDLER);
  if (!h) return null;
  const parts = h[3].split('$');
  const ids = modIds();
  if (parts.length > 1 && ids.has(parts[0])) return { kind: h[1], mod: parts[0], name: parts.slice(1).join('$') };
  return { kind: h[1], mod: null, name: h[3] };
}

let idsCache = null;
function modIds() {
  const idx = classIndex();
  if (idsCache?.idx === idx) return idsCache.ids;
  const ids = new Set();
  for (const jar of idx.jars) if (jar !== PLATFORM) for (const m of jarMeta(jar).mods) ids.add(m.id);
  idsCache = { idx, ids };
  return ids;
}

function frameInfo(f) {
  const [, cls, method, file, jarTag, tags] = f;
  const internal = cls.replaceAll('.', '/');
  const rec = classRecord(internal) ?? classRecord(internal.split('$')[0]);
  const jarName = jarTag?.match(/^([^%!:]+?\.jar)/)?.[1] ?? null;
  const owner = rec ? modOf(rec.jar) : isRuntimeClass(internal) ? 'jdk/библиотека' : (jarName ?? '?');
  const h = parseHandler(method);
  return {
    cls,
    internal,
    method,
    file,
    line: Number(file.split(':')[1]) || null,
    owner,
    platform: !rec || rec.jar === PLATFORM || isRuntimeClass(internal),
    mixined: Boolean(tags && /mixin/.test(tags)),
    handler: h,
  };
}

/** Миксины, которые могли дать обработчик name в классе cls: по индексу (цели миксинов) */
function handlerSources(internal, handler) {
  const idx = classIndex();
  const out = [];
  for (const r of idx.mixinsOf.get(internal) ?? []) {
    let c;
    try {
      c = readClass(r);
    } catch {
      continue;
    }
    if (c.methods.some((m) => m.name === handler.name)) out.push(`${modOf(r.jar)}/${javaName(r.name)}`);
  }
  return out;
}

/** Сигнатура из NoSuchMethodError: 'void net.foo.Bar.baz(int, java.lang.String)' или net.foo.Bar.baz(I)V */
function decodeMissingMember(type, msg) {
  const out = [];
  let owner;
  let name;
  let m =
    msg.match(/'(?:[\w.$[\]<>]+\s+)?([\w.$]+)\.([\w$<>]+)\(([^)]*)\)'/) ?? msg.match(/^([\w.$]+)\.([\w$<>]+)\((.*)$/);
  if (m) [, owner, name] = m;
  else if ((m = msg.match(/Class ([\w.$]+) does not have member field '(?:[\w.$[\]]+\s+)?([\w$]+)'/)))
    [, owner, name] = m;
  else if ((m = msg.match(/'(?:[\w.$[\]<>]+\s+)?([\w.$]+)\.([\w$]+)'/))) [, owner, name] = m;
  if (!owner) return out;
  const internal = owner.replaceAll('.', '/');
  const recs = classIndex().byName.get(internal) ?? [];
  if (!recs.length) {
    out.push(`класса ${owner} нет в сборке${isRuntimeClass(internal) ? ' (класс JDK/библиотеки)' : ''}`);
    return out;
  }
  for (const r of recs) {
    const c = readClass(r);
    const ms = c.methods.filter((x) => x.name === name).map((x) => methodShort(x.name, x.desc));
    const fs_ = c.fields.filter((x) => x.name === name).map((x) => x.name);
    out.push(
      `${javaName(internal)} из ${modOf(r.jar)} (${r.jar === PLATFORM ? 'Minecraft/NeoForge' : r.jar}): ${ms.length || fs_.length ? `есть ${[...ms, ...fs_].join('; ')} — другая сигнатура` : `нет «${name}» вовсе`}`,
    );
  }
  out.push(
    `${type.includes('Field') ? 'поле' : 'метод'} вызывает мод, собранный под другую версию ${modOf(recs[0].jar)}: обновить/откатить один из двух`,
  );
  return out;
}

function explain(type, msg, frames) {
  const t = type.slice(type.lastIndexOf('.') + 1);
  const out = [];
  if (/NoSuchMethodError|NoSuchFieldError|AbstractMethodError|IncompatibleClassChangeError/.test(t))
    out.push(...decodeMissingMember(t, msg ?? ''));
  if (/ClassNotFoundException|NoClassDefFoundError/.test(t)) {
    const cls = (msg ?? '').trim().split(/\s/)[0].replaceAll('.', '/');
    const recs = classIndex().byName.get(cls) ?? [];
    if (recs.length)
      out.push(
        `класс ${javaName(cls)} есть в ${recs.map((r) => modOf(r.jar)).join(', ')} — значит, не загрузился сам (смотрите Caused by) или мод не той стороны`,
      );
    else if (cls.startsWith('net/minecraft/client/') || cls.startsWith('com/mojang/blaze3d/'))
      out.push('клиентский класс на сервере: мод не разделяет стороны — его не ставить на сервер или обновить');
    else
      out.push(
        `класса ${cls.replaceAll('/', '.')} нет ни в одном jar: не хватает мода или библиотеки (ищите, чей пакет)`,
      );
  }
  if (/ClassCastException/.test(t)) {
    const m = (msg ?? '').match(/class ([\w.$]+) cannot be cast to class ([\w.$]+)/);
    if (m)
      for (const c of [m[1], m[2]]) {
        const r = classRecord(c.replaceAll('.', '/'));
        out.push(`${javaName(c)} — ${r ? modOf(r.jar) : 'нет в сборке'}`);
      }
  }
  // Миксин: «Mixin [tfc.mixins.json:FooMixin] from mod tfc failed …», «… in tfc.mixins.json:FooMixin from mod tfc»
  const mx = `${msg ?? ''}`.match(/([\w.-]+\.json):([\w.$]+)(?:.*?from mod (\w+))?/);
  if (mx || /Mixin|Injection/.test(t)) {
    if (mx) {
      const rec = mixinFromConfig(mx[1], mx[2]);
      out.push(
        `миксин ${rec ? rec.name.replaceAll('/', '.') : mx[2]} из ${mx[1]}${mx[3] ? ` (мод ${mx[3]})` : ''} — mixins class=…`,
      );
    }
    const tgt = `${msg ?? ''}`.match(/matching '([^']+)' in ([\w$/]+[\w$])/);
    if (tgt)
      out.push(
        `в ${tgt[2].replaceAll('/', '.')} нет «${tgt[1]}» в том виде, как ждёт миксин: другая версия Minecraft/мода или метод уже переписал другой миксин`,
      );
  }
  const first = frames.find((f) => !f.platform);
  if (first)
    out.push(
      `первая строка стека из мода: ${first.owner} — ${javaName(first.internal)}.${first.method}${first.line ? `:${first.line}` : ''}`,
    );
  const hs = frames.filter((f) => f.handler);
  for (const f of hs.slice(0, 5)) {
    const src = f.handler.mod ? [f.handler.mod] : handlerSources(f.internal, f.handler);
    out.push(
      `обработчик миксина в стеке: ${javaName(f.internal)}.${f.method} → ${src.length ? src.join(', ') : 'мод не определён'}`,
    );
  }
  const mixed = [...new Set(frames.filter((f) => f.mixined && f.platform && !f.handler).map((f) => f.internal))].slice(
    0,
    3,
  );
  for (const c of mixed) {
    const n = classIndex().mixinsOf.get(c)?.length ?? 0;
    if (n) out.push(`в стеке ${javaName(c)} — на него ${n} миксинов (mixins target="${c.replaceAll('/', '.')}")`);
  }
  return out;
}

/** Разбор блока стека: [{ type, msg, frames, more }] — главное исключение и Caused by */
function parseThrowables(lines) {
  const out = [];
  let cur = null;
  for (const l of lines) {
    const e = l.match(EXC);
    if (e && !FRAME.test(l)) {
      cur = { type: e[1], msg: e[2] ?? '', frames: [], caused: /^\s*Caused by/.test(l) };
      out.push(cur);
      continue;
    }
    const f = l.match(FRAME);
    if (f && cur) cur.frames.push(frameInfo(f));
  }
  return out;
}

function throwableText(t, limitFrames = 6) {
  const out = [`${t.caused ? 'Caused by: ' : ''}${t.type}${t.msg ? `: ${short(t.msg, 400)}` : ''}`];
  const shown = [];
  // Кадры: первые несколько и все из модов (кроме платформы), не больше limitFrames
  for (const f of t.frames) {
    if (shown.length >= limitFrames) break;
    if (shown.length < 2 || !f.platform || f.handler) shown.push(f);
  }
  for (const f of shown)
    out.push(
      `    at ${javaName(f.internal)}.${f.method}${f.line ? `:${f.line}` : ''} [${f.owner}]${f.handler ? ' ← миксин' : f.mixined ? ' {mixin}' : ''}`,
    );
  if (t.frames.length > shown.length) out.push(`    … кадров всего ${t.frames.length}`);
  for (const x of explain(t.type, t.msg, t.frames)) out.push(`  → ${x}`);
  return out;
}

// ---------------------------------------------------------------- строки лога

const LINE_NF = /^\[([^\]]+)\] \[([^\]]+?)\/(\w+)\] \[([^\]]*)\]: ?(.*)$/;
const LINE_VANILLA = /^\[([\d:.]+)\] \[([^\]]+?)\/(\w+)\]: ?(.*)$/;

function parseLog(text) {
  const recs = [];
  let cur = null;
  const lines = text.replace(/\r/g, '').split('\n');
  for (const [i, raw] of lines.entries()) {
    const l = maskIp(raw);
    let m = l.match(LINE_NF);
    if (m) cur = { n: i + 1, time: m[1], thread: m[2], level: m[3].toUpperCase(), logger: m[4], msg: m[5], extra: [] };
    else if ((m = l.match(LINE_VANILLA)))
      cur = { n: i + 1, time: m[1], thread: m[2], level: m[3].toUpperCase(), logger: '', msg: m[4], extra: [] };
    else {
      if (cur && l.trim()) cur.extra.push(l);
      continue;
    }
    recs.push(cur);
  }
  return recs;
}

/** Класс миксина из «конфиг.json:Класс»: пакет — из конфига в jar мода */
function mixinFromConfig(config, cls) {
  const reg = classIndex();
  for (const r of reg.all)
    if (r.mixin && (r.name.endsWith(`/${cls.replaceAll('.', '/')}`) || r.name.endsWith(`.${cls}`))) {
      const meta = jarMeta(r.jar);
      if (meta.mixinConfigs.some((m) => m.file === config)) return r;
    }
  return null;
}

/** Подсказки по известным сообщениям */
function hints(r) {
  const s = `${r.msg} ${r.extra.slice(0, 3).join(' ')}`;
  const out = [];
  let m;
  if ((m = s.match(/@Mixin target ([\w.$]+) was not found ([\w.-]+\.json):([\w.$]+) from mod (\w+)/)))
    out.push(
      `цель миксина ${m[1]} не найдена (мод ${m[4]}): такого мода нет — миксин пропущен; для совместимости с необязательным модом это нормально`,
    );
  else if ((m = s.match(/([\w.-]+\.json):([\w.$]+) from mod (\w+)/))) {
    const rec = mixinFromConfig(m[1], m[2]);
    out.push(
      `миксин ${rec ? rec.name.replaceAll('/', '.') : m[2]} (${m[1]}, мод ${m[3]}) — mixins class="${rec ? rec.name.replaceAll('/', '.') : m[2]}"`,
    );
    const t = s.match(/matching '([^']+)' in ([\w$/]+[\w$])/);
    if (t) {
      const target = t[2].replaceAll('/', '.');
      out.push(
        `в ${target} нет «${t[1]}» в том виде, как ждёт миксин: другая версия Minecraft/мода или метод уже переписал другой миксин — mixins target="${target}" method="${t[1].replace(/\(.*$/, '')}"`,
      );
    }
    if (/Mixin apply.*failed|InvalidInjectionException|InjectionError/.test(s))
      out.push(
        'ошибка применения: если конфиг required — сервер не запустится (Mixin 0.8.7, MixinProcessor), иначе миксин пропущен',
      );
  }
  if ((m = s.match(/Mod ID: '(\w+)', Requested by: '(\w+)', Expected range: '([^']+)', Actual version: '([^']+)'/)))
    out.push(`мод ${m[2]} требует ${m[1]} ${m[3]}, стоит ${m[4]} — mods_check mod="${m[2]}"`);
  if (
    (m = s.match(
      /(?:Couldn't parse data file|Parsing error loading recipe|Couldn't load|Failed to load) '?([a-z0-9_.-]+):([\w/.-]+)'?/,
    ))
  )
    out.push(
      `битые данные ${m[1]}:${m[2]} — из мода/датапака «${m[1]}» или kubejs/data (recipe_get id="${m[1]}:${m[2]}")`,
    );
  if ((m = s.match(/((?:server|startup|client)_scripts):([\w/.-]+\.js)#(\d+)/)))
    out.push(`скрипт KubeJS ${m[1]}/${m[2]}, строка ${m[3]} — kubejs_read`);
  if ((m = s.match(/Unknown (?:registry key|item|block|fluid)[^']*'([a-z0-9_.-]+:[\w/.-]+)'/i)))
    out.push(`${m[1]} нет в сборке: мод убран или id с опечаткой (items_search / lang_search)`);
  if (/Configuration file .* is not correct\. Correcting/.test(s))
    out.push('конфиг исправлен по умолчанию: ключи не совпали с версией мода — config_get');
  return out;
}

const normMsg = (s) =>
  s
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/-?\d+(\.\d+)?/g, '#')
    .slice(0, 300);

const IMPORTANT_WARN =
  /mixin|Mixin|missing|Missing|not found|failed|Failed|Couldn't|Unknown|Exception|Error|requires|incompatible|refused|Correcting/;

function logAnalyze(a) {
  const input = readInput(a);
  const text = input.text;
  const out = [`Файл: ${input.name} — ${text.split('\n').length} строк`];
  if (input.others?.length) out.push(`рядом есть: ${input.others.join(', ')}`);
  const level = String(a.level ?? 'error');
  const q = a.query ? new RegExp(a.query, 'i') : null;

  // Краш-репорт: описание, исключение, подозреваемые моды, ошибки загрузки модов
  if (/---- Minecraft Crash Report ----/.test(text)) {
    const desc = text.match(/^Description: (.*)$/m)?.[1];
    out.push(`Краш-репорт${desc ? `: ${desc}` : ''}`);
    const suspects = text.match(/^Suspected Mods?: (.*)$/m)?.[1];
    if (suspects) out.push(`Minecraft подозревает: ${suspects}`);
    const body = text.split(/\nA detailed walkthrough of the error/)[0].split('\n');
    const head = parseThrowables(body.slice(body.findIndex((l) => l.startsWith('Description:')) + 1));
    for (const t of head) out.push(...throwableText(t, 8));
    // Ошибки загрузки модов: блоки «-- Mod loading issue for: x --»
    for (const m of text.matchAll(/-- Mod loading issue for: (\S+) --\n([\s\S]*?)(?=\n-- |\n\n\S)/g)) {
      const fail = m[2].match(/Failure message: (.*)/)?.[1];
      const file = m[2].match(/Mod File: (.*)/)?.[1];
      out.push(`Мод ${m[1]} не загрузился${file ? ` (${path.basename(file.trim())})` : ''}: ${short(fail ?? '', 400)}`);
      for (const t of parseThrowables(m[2].split('\n')).slice(0, 2))
        out.push(...throwableText(t, 5).map((x) => `  ${x}`));
    }
    const mixinErr = [...text.matchAll(/(Mixin \[[^\]]+\] from mod \w+[^\n]*)/g)].map((x) => x[1]);
    for (const x of [...new Set(mixinErr)].slice(0, 5)) {
      out.push(`Миксин: ${short(x, 300)}`);
      for (const h of hints({ msg: x, extra: [] })) out.push(`  → ${h}`);
    }
    return clip(maskIp(out.join('\n')));
  }

  // Лог: записи ERROR/FATAL (и WARN по level=warn), одинаковые — вместе
  const recs = parseLog(text);
  if (!recs.length) {
    // Просто стек (вставлен текстом)
    const ts = parseThrowables(text.split('\n'));
    if (!ts.length) return `${out.join('\n')}\nНе похоже ни на лог, ни на краш-репорт, ни на стек.`;
    for (const t of ts) out.push(...throwableText(t, 8));
    return clip(maskIp(out.join('\n')));
  }
  const levels = new Map();
  for (const r of recs) levels.set(r.level, (levels.get(r.level) ?? 0) + 1);
  out.push(
    `Записей: ${recs.length} — ${[...levels].map(([l, n]) => `${l} ${n}`).join(', ')}; с ${recs[0].time} по ${recs.at(-1).time}`,
  );
  const loaded = text.match(/Loading (\d+) mods:/)?.[1];
  if (loaded) out.push(`Загружено модов: ${loaded}`);
  const want = (r) => {
    if (q && !q.test(`${r.logger} ${r.msg} ${r.extra.join(' ')}`)) return false;
    if (r.level === 'ERROR' || r.level === 'FATAL') return true;
    if (r.level === 'WARN')
      return (
        level === 'warn' ||
        level === 'all' ||
        (r.extra.length > 0 && r.extra.some((l) => FRAME.test(l))) ||
        IMPORTANT_WARN.test(r.msg)
      );
    return level === 'all' || Boolean(q);
  };
  const groups = new Map();
  for (const r of recs) {
    if (!want(r)) continue;
    const key = `${r.level}|${r.logger}|${normMsg(r.msg)}`;
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { r, count: 1 });
  }
  const list = [...groups.values()].sort((x, y) => {
    const rank = (g) => (g.r.level === 'FATAL' ? 0 : g.r.level === 'ERROR' ? 1 : 2);
    return rank(x) - rank(y) || x.r.n - y.r.n;
  });
  out.push(
    `Отобрано: ${list.length} разных сообщений (${level === 'error' ? 'ERROR/FATAL и важные WARN' : level}${q ? `, по «${a.query}»` : ''}).`,
  );
  const body = page(
    list,
    a,
    ({ r, count }) => {
      const lines = [
        `#${r.n} ${r.level} [${r.logger || r.thread}]${count > 1 ? ` ×${count}` : ''}: ${short(r.msg, 500)}`,
      ];
      for (const h of hints(r)) lines.push(`  → ${h}`);
      const ts = parseThrowables([r.msg, ...r.extra]);
      for (const t of ts.slice(0, 3)) lines.push(...throwableText(t, 5).map((x) => `  ${x}`));
      if (!ts.length && r.extra.length) lines.push(...r.extra.slice(0, 4).map((x) => `  ${short(x, 300)}`));
      return lines;
    },
    15,
  );
  return clip(maskIp(`${out.join('\n')}\n${body}`));
}

export const TOOLS = [
  {
    name: 'log_analyze',
    description:
      'Разбор лога или краш-репорта (latest.log, debug.log, crash-*.txt, .gz, папка игры/сервера — берёт свежий; или text — вставленный стек): ошибки без повторов, стек → jar и мод, обработчики миксинов → мод, расшифровка NoSuchMethodError/нет класса/миксин не применился/не хватает зависимости/битые данные и скрипты KubeJS. IP игроков скрыты.',
    inputSchema: {
      type: 'object',
      properties: {
        path: str('файл лога/краш-репорта или папка игры/сервера'),
        text: str('или сам текст (стек, кусок лога)'),
        level: str('error (по умолчанию: ERROR/FATAL и важные WARN), warn или all'),
        query: str('только сообщения по регулярке'),
        ...paging,
      },
    },
    handler: logAnalyze,
  },
];
