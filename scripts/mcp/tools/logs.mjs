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
import { clip, page, paging, short, str, userRegex } from '../fmt.mjs';
import { PLATFORM, jarList, nestedJars } from '../jars.mjs';

const maskIp = (s) => s.replace(/\/\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?/g, '/<ip>');
const modOf = (jar) => (jar === PLATFORM ? 'minecraft' : jarOwner(jar));

function readInput(a) {
  if (a.text) return { name: 'текст', text: String(a.text).replace(/\r/g, '') };
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
  return { name: p, text: buf.toString('utf8').replace(/\r/g, ''), others };
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

// ---------------------------------------------------------------- краш-репорт

/** Моды, которые сами просят проверить краш без них (шапка Connector, Sable…): «… not caused by X …» */
function crashWarnings(pre) {
  const out = new Set();
  for (const m of pre.matchAll(
    /(?:not caused by|verify issues are not caused by|reproduce it without) ([A-Z][\w-]*(?: [A-Z][\w-]*)?)/g,
  ))
    out.add(m[1]);
  if (/SINYTRA CONNECTOR IS PRESENT/i.test(pre)) out.add('Connector');
  return [...out];
}

/** Разделы «-- Имя --»: [{ title, lines }] */
function crashSections(text) {
  const out = [];
  let cur = null;
  for (const l of text.split('\n')) {
    const m = l.match(/^-- (.+) --$/);
    if (m) out.push((cur = { title: m[1], lines: [] }));
    else if (cur) cur.lines.push(l);
  }
  return out;
}

/** Сведения «Ключ: значение» раздела (с табуляцией в начале), без стека */
function sectionDetails(lines) {
  const out = [];
  for (const l of lines) {
    if (/^\s*Stacktrace:/.test(l)) break;
    const m = l.match(/^\t([^\t:][^:]*): (.*)$/);
    if (m) out.push([m[1].trim(), m[2].trim()]);
  }
  return out;
}

/** Моды сборки сайта: id → версия (jar из mods/ и вложенные jar-in-jar — FML показывает их в списке) */
function packMods() {
  const out = new Map();
  try {
    for (const jar of [...jarList(), ...nestedJars()])
      for (const m of jarMeta(jar).mods) if (!out.has(m.id)) out.set(m.id, m.version);
  } catch {
    /* нет mods/ — без сравнения */
  }
  return out;
}

/** Таблица «Mod List» из System Details: [{ jar, name, id, version }] */
function crashModList(lines) {
  const out = [];
  for (const l of lines) {
    const m = l.match(/^\t\t(\S.*?)\s*\|(.*?)\s*\|(\S+)\s*\|(\S+)\s*\|/);
    if (m) out.push({ jar: m[1], name: m[2].trim(), id: m[3], version: m[4] });
  }
  return out;
}

function compareWithPack(list) {
  const pack = packMods();
  if (!pack.size || !list.length) return [];
  // Столбец id в таблице обрезан до 30 символов
  const idOf = (id) => (pack.has(id) || id.length < 30 ? id : ([...pack.keys()].find((k) => k.startsWith(id)) ?? id));
  for (const m of list) m.id = idOf(m.id);
  const theirs = new Map(list.map((m) => [m.id, m]));
  const skip = new Set(['minecraft', 'neoforge']);
  const extra = list.filter((m) => !pack.has(m.id) && !skip.has(m.id));
  const missing = [...pack.keys()].filter((id) => !theirs.has(id) && !skip.has(id));
  // Версия в таблице обрезана до 20 символов — сравниваем по началу
  const differ = list.filter((m) => {
    const v = pack.get(m.id);
    return v && v !== '?' && !skip.has(m.id) && !String(v).startsWith(m.version) && !m.version.startsWith(v);
  });
  const lst = (arr, f) => `${arr.slice(0, 12).map(f).join(', ')}${arr.length > 12 ? ` … ещё ${arr.length - 12}` : ''}`;
  const out = [`Сверка со сборкой сайта (mods/, ${pack.size} модов):`];
  if (extra.length + missing.length > (pack.size + list.length) / 3)
    out.push('  ⚠ различий очень много — похоже, у игрока другая сборка или другая её версия');
  if (extra.length)
    out.push(`  у игрока есть, в сборке нет: ${extra.length} — ${lst(extra, (m) => `${m.id} ${m.version}`)}`);
  if (missing.length) out.push(`  в сборке есть, у игрока нет: ${missing.length} — ${lst(missing, (id) => id)}`);
  if (differ.length)
    out.push(
      `  другие версии: ${differ.length} — ${lst(differ, (m) => `${m.id} ${m.version} (в сборке ${pack.get(m.id)})`)}`,
    );
  if (out.length === 1) out.push('  совпадает');
  return out;
}

/** Миксины из пометок кадра: «pl:mixin:APP:file.json:Cls from mod M» → [мод] */
const frameMixinMods = (raw) => [...raw.matchAll(/pl:mixin:APP:[^,}]*? from mod ([\w-]+)/g)].map((m) => m[1]);

function crashReport(text) {
  const out = [];
  const [pre] = text.split(/\nTime: /);
  const desc = text.match(/^Description: (.*)$/m)?.[1];
  out.push(
    `Краш-репорт${desc ? `: ${desc}` : ''}${text.match(/^Time: (.*)$/m) ? ` (${text.match(/^Time: (.*)$/m)[1]})` : ''}`,
  );
  const warn = crashWarnings(pre);
  if (warn.length)
    out.push(
      `Шапка: ${warn.join(', ')} — эти моды сами просят сначала проверить краш без них (Connector — Fabric-моды на NeoForge; ошибки в переведённых им модах часто его)`,
    );
  const suspects = text.match(/^Suspected Mods?: (.*)$/m)?.[1];
  if (suspects) out.push(`Minecraft подозревает: ${suspects}`);
  const sections = crashSections(text);
  const head = sections.find((x) => x.title === 'Head');
  const thread = head?.lines.find((l) => l.startsWith('Thread: '))?.slice(8);
  if (thread)
    out.push(
      `Поток: ${thread}${/^Server thread$/.test(thread) ? ' (сервер)' : /Render thread/.test(thread) ? ' (клиент, отрисовка)' : ''}`,
    );

  const body = text.split(/\nA detailed walkthrough of the error/)[0].split('\n');
  const rawFrames = body.filter((l) => FRAME.test(l));
  const head_ = parseThrowables(body.slice(body.findIndex((l) => l.startsWith('Description:')) + 1));
  for (const t of head_) out.push(...throwableText(t, 8));
  // Моды по стеку: владельцы кадров (без Minecraft/JDK) по порядку и миксины на верхних кадрах
  const frames = head_.flatMap((t) => t.frames);
  const owners = [];
  for (const f of frames) if (!f.platform && !owners.includes(f.owner)) owners.push(f.owner);
  if (owners.length) out.push(`Моды в стеке (сверху вниз): ${owners.slice(0, 10).join(', ')}`);
  const firstMod = Math.max(
    0,
    frames.findIndex((f) => !f.platform),
  );
  const topMixins = new Set(rawFrames.slice(0, firstMod + 3).flatMap(frameMixinMods));
  if (topMixins.size)
    out.push(
      `Миксины на классах верхних кадров: ${[...topMixins].slice(0, 15).join(', ')} — mixins target=… покажет, что они меняют`,
    );
  if (!head_.length) out.push('Исключение не разобралось — смотрите Description и раздел -- Head -- в файле.');

  // Подробности разделов (уровень, блок, сущность, экран…), кроме служебных
  const SKIP = /^(Head|System Details|Uptime|Last reload|Dynamic Lighting|Mod loading issue for: .*)$/;
  for (const sec of sections) {
    if (SKIP.test(sec.title)) continue;
    const d = sectionDetails(sec.lines);
    if (d.length)
      out.push(
        `-- ${sec.title}: ${d
          .slice(0, 8)
          .map(([k, v]) => `${k}: ${short(v, 160)}`)
          .join('; ')}`,
      );
  }

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

  // Система и список модов
  const sys = sections.find((x) => x.title === 'System Details');
  if (sys) {
    const d = new Map(sectionDetails(sys.lines));
    const mem = d.get('Memory')?.match(/up to (\d+) bytes/)?.[1];
    const parts = [
      d.get('Type'),
      d.get('NeoForge') && `NeoForge ${d.get('NeoForge')}`,
      d.get('Minecraft Version') && `Minecraft ${d.get('Minecraft Version')}`,
      d.get('Java Version') && `Java ${d.get('Java Version')}`,
      mem && `память до ${Math.round(Number(mem) / 2 ** 20)} МБ`,
      d.get('Operating System'),
      d.get('Launched Version') && `версия в лаунчере «${d.get('Launched Version')}»`,
      d.get('Loaded Shaderpack') && `шейдеры ${d.get('Loaded Shaderpack')}`,
      d.get('Sinytra Connector') && `Connector ${d.get('Sinytra Connector')}`,
    ].filter(Boolean);
    if (parts.length) out.push(`Система: ${parts.join(', ')}`);
    const list = crashModList(sys.lines);
    if (list.length) {
      out.push(`Модов в списке краша: ${list.length}`);
      out.push(...compareWithPack(list));
    }
  }
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
  const q = a.query ? userRegex(a.query) : null;

  // Краш-репорт: шапка, описание, исключение, моды по стеку, подробности, система и список модов
  if (/---- Minecraft Crash Report ----/.test(text)) {
    out.push(...crashReport(text));
    return clip(maskIp(out.join('\n')));
  }
  if (level === 'timeline') return clip(maskIp(`${out.join('\n')}\n${timeline(parseLog(text), a, q)}`));

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

// ---------------------------------------------------------------- хронология

/** Шум, которого в хронологии не бывает даже по query: LOD-рендер, прегенерация, рецепты, JEI/EMI */
const NOISE =
  /^(Voxy|Roxy|ChunkBuilder|ByePregen|EMI|mezz\.jei\.|net\.minecraft\.world\.item\.crafting\.RecipeManager|net\.minecraft\.client\.ClientRecipeBook|Sodium|flywheel|net\.minecraft\.client\.resources\.model\.|net\.minecraft\.client\.sounds\.)|Ingredients are being removed/;
/** Служебные строки сервера, которые не события игры */
const SERVER_SERVICE =
  /^(Saving chunks for level|Preparing (start region|spawn area)|Generating keypair|Starting (minecraft server|Minecraft server on)|Loading properties|Default game type|Using |Time elapsed|Done \(|ThreadedAnvilChunkStorage|Preparing level|Changing (view|simulation) distance)/;

const dimName = (s) =>
  s
    .replace(/ResourceKey\[minecraft:dimension \/ ([\w:./-]+)\]/g, '$1')
    .replace(/\bminecraft:/g, '')
    .trim();
const coords = (x, y, z) => [x, y, z].map((v) => Math.round(Number(v))).join(' ');
const hms = (t) => t.match(/(\d\d:\d\d:\d\d)/)?.[1] ?? t;

/** Событие игры из записи лога: { kind, text } или null */
function gameEvent(r) {
  const m0 = r.msg;
  const lg = r.logger;
  let m;
  if ((m = m0.match(/^(\S+?)\[[^\]]*\] logged in with entity id \d+ at \(([-\d.]+), ([-\d.]+), ([-\d.]+)\)/)))
    return { kind: 'вход', text: `${m[1]} вошёл в ${coords(m[2], m[3], m[4])}` };
  if ((m = m0.match(/^(\S+) lost connection: (.*)/))) return { kind: 'выход', text: `${m[1]} отключился: ${m[2]}` };
  if ((m = m0.match(/^(\S+) issued server command: (.*)/))) return { kind: 'команда', text: `${m[1]}: ${m[2]}` };
  if ((m = m0.match(/^Reloading pipeline on dimension change: (\S+) => (\S+)/)) && /Iris/.test(lg))
    return { kind: 'измерение', text: `${dimName(m[1])} → ${dimName(m[2])} (клиент, Iris)`, dim: dimName(m[2]) };
  if ((m = m0.match(/Dimension change: (.+?) → (.+)$/)))
    return {
      kind: 'измерение',
      text: `${dimName(m[1])} → ${dimName(m[2])} (клиент, JourneyMap)`,
      dim: dimName(m[2]),
      jm: true,
    };
  if ((m = m0.match(/^Can't keep up! .*?Running (\d+)ms or (\d+) ticks behind/)))
    return { kind: 'лаг', text: `сервер отстаёт на ${(Number(m[1]) / 1000).toFixed(1)} с` };
  if (/^Saving and pausing game|^Saving the game|^Saving worlds|^Saving players/.test(m0))
    return { kind: 'сохранение', text: m0 };
  if (/^Starting integrated minecraft server|^Starting minecraft server version/.test(m0))
    return { kind: 'сервер', text: m0 };
  if (/^Stopping server|^Stopping the server|^Stopping!$/.test(m0))
    return { kind: 'стоп', text: `${m0} [${r.thread}]` };
  if ((m = m0.match(/^Connecting to (.*)/)) && /ConnectScreen/.test(lg)) return { kind: 'подключение', text: m[1] };
  if (/ChatComponent/.test(lg) && (m = m0.match(/^\[(?:System\] \[)?CHAT\] (.*)/)))
    return { kind: 'чат', text: m[1], chat: true };
  if (/MinecraftServer|DedicatedServer/.test(lg) && r.level === 'INFO' && !SERVER_SERVICE.test(m0)) {
    // [Игрок: текст] — ответ команды, разосланный операторам; остальное — чат, вход/выход, смерти, достижения
    if ((m = m0.match(/^\[(\S+?): (.*)\]$/))) return { kind: 'команда', text: `${m[1]} → ${m[2]}` };
    return { kind: 'сервер', text: m0, said: true };
  }
  return null;
}

/** Ключ для схлопывания дублей «сервер → чат клиента» (одна строка приходит дважды) */
const dupKey = (t) => t.replace(/^\S+ → /, '').replace(/^\[\S+?: (.*)\]$/, '$1');

function timeline(recs, a, q) {
  const events = [];
  const errSeen = new Map();
  let lastSave = -1e9;
  let lastDim = null;
  const recent = []; // последние тексты сервера (для дублей в чате клиента)
  let inGame = false;
  for (const r of recs) {
    const quiet = NOISE.test(r.logger) || NOISE.test(r.msg);
    let ev = quiet ? null : gameEvent(r);
    if (ev?.kind === 'вход' || ev?.kind === 'подключение') inGame = true;
    if (!ev && !quiet && q && q.test(`${r.logger} ${r.msg}`))
      ev = { kind: 'строка', text: `[${r.logger || r.thread}] ${r.msg}` };
    // Ошибки во время игры (после входа): по одной на вид, с числом повторов
    if (!ev && !quiet && inGame && (r.level === 'ERROR' || r.level === 'FATAL')) {
      // Одинаковые с точностью до id и чисел — одна строка; блок строк одного логгера в ту же секунду — одна строка
      const key = `${r.logger}|${normMsg(r.msg.replace(/[a-z0-9_.-]+:[\w/.-]+/g, '<id>'))}`;
      const seen = errSeen.get(key);
      const last = events.at(-1);
      if (seen) {
        seen.count++;
        continue;
      }
      if (last?.kind === 'ошибка' && last.logger === r.logger && last.time === hms(r.time)) {
        if (last.parts < 4) last.text += ` / ${r.msg}`;
        last.parts++;
        errSeen.set(key, last);
        continue;
      }
      ev = { kind: 'ошибка', text: `[${r.logger || r.thread}] ${r.msg}`, count: 1, logger: r.logger, parts: 1 };
      errSeen.set(key, ev);
    }
    if (!ev) continue;
    const sec = r.time.match(/(\d\d):(\d\d):(\d\d)/);
    const t = sec ? Number(sec[1]) * 3600 + Number(sec[2]) * 60 + Number(sec[3]) : 0;
    if (ev.kind === 'сохранение') {
      if (t - lastSave < 30) continue;
      lastSave = t;
    }
    // Смена измерения: Iris и JourneyMap пишут одно и то же — второй раз не показываем
    if (ev.dim) {
      if (lastDim && lastDim.dim === ev.dim && t - lastDim.t < 15) continue;
      lastDim = { dim: ev.dim, t };
    }
    if (ev.chat) {
      const k = dupKey(ev.text);
      if (recent.some((x) => x.k === k && t - x.t <= 2)) continue;
    } else if (ev.kind === 'команда' || ev.said) recent.push({ k: dupKey(ev.text), t });
    if (recent.length > 20) recent.shift();
    ev.n = r.n;
    ev.time = hms(r.time);
    events.push(ev);
  }
  const counts = new Map();
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  const head = [
    `Хронология: ${events.length} событий — ${[...counts].map(([k, n]) => `${k} ${n}`).join(', ')}${q ? `; плюс строки по «${a.query}»` : ''}.`,
    'Время — из лога; «#N» — строка файла. Ошибки — только после входа в мир, по одной на вид (×N — повторы).',
  ];
  return `${head.join('\n')}\n${page(
    events,
    a,
    (e) => [`${e.time} #${e.n} ${e.kind}: ${short(e.text, 300)}${e.count > 1 ? ` ×${e.count}` : ''}`],
    150,
  )}`;
}

export const TOOLS = [
  {
    name: 'log_analyze',
    description:
      'Analyse a log or crash report (latest.log, debug.log, crash-*.txt, .gz, game/server folder — takes the newest; or text — a pasted stack): deduplicated errors, stack → jar and mod, mixin handlers → mod, decoding NoSuchMethodError/missing class/mixin not applied/missing dependency/broken data and KubeJS scripts. Player IPs hidden.',
    inputSchema: {
      type: 'object',
      properties: {
        path: str('log/crash report file or game/server folder'),
        text: str('or the text itself (stack, log excerpt)'),
        level: str(
          'error (default: ERROR/FATAL and important WARN), warn, all or timeline — game chronology: joins/leaves with coordinates, dimension changes, commands and replies, chat, deaths, saves, lag, errors after joining; LOD/recipe/JEI noise removed',
        ),
        query: str(
          'regex, case-insensitive ((?i) allowed, not needed); in error/warn/all — only such messages, in timeline — extra lines added to events',
        ),
        ...paging,
      },
    },
    handler: logAnalyze,
  },
];
