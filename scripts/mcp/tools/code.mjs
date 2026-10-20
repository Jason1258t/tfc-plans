/**
 * Инструменты MCP: код модов для отладки сборки — поиск классов, сведения о классе, иерархия, кто что вызывает
 * (по байткоду), миксины и их конфликты, декомпиляция, поиск по файлам jar, проверка зависимостей модов.
 *
 * Код — из всех jar mods/, их вложенных библиотек (jar-in-jar) и Minecraft + NeoForge с именами Mojang
 * (кеш сборки аддонов, см. jars.mjs). Индекс классов — code-index.mjs, разбор .class — bytecode.mjs.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MODS } from '../data.mjs';
import {
  ACC,
  annotationText,
  classKind,
  codeRefs,
  descClasses,
  fieldType,
  javaName,
  methodShort,
  methodSig,
  modifiers,
  parseClassFull,
  valueText,
} from '../bytecode.mjs';
import {
  classIndex,
  classRecord,
  compareVersions,
  findClasses,
  inRange,
  isInterface,
  isRuntimeClass,
  jarMeta,
  jarOwner,
  mixinConfig,
  oneClass,
  rangeMin,
  readClass,
  subtypes,
  superChain,
} from '../code-index.mjs';
import { clip, page, paging, short, str, textTest, userRegex } from '../fmt.mjs';
import { scriptLines } from './kubejs.mjs';
import {
  PLATFORM,
  PLATFORM_SOURCES,
  allJars,
  jarFile,
  jarList,
  jarToc,
  nestedJars,
  pathMatcher,
  platform,
  readEntry,
  resolveJar,
} from '../jars.mjs';

const dotted = (n) => n.replaceAll('/', '.');
const bool = (description) => ({ type: 'boolean', description });
const CACHE = path.join(path.dirname(MODS), '.cache', 'mcp');

/** «TerraFirmaCraft-…jar (tfc)» */
const where = (jar) => {
  const owner = jarOwner(jar);
  return jar === PLATFORM ? owner : `${jar} (${owner})`;
};
/** Короткая подпись модуля для списков: id мода или имя вложенной библиотеки */
const modOf = (jar) => (jar === PLATFORM ? 'minecraft' : jarOwner(jar));

/** Внутренний jar по параметру: любой архив, включая вложенные и minecraft */
const anyJar = (q) => (q ? resolveJar(q, true) : null);

// ---------------------------------------------------------------- стороны: клиент / сервер

const ONLY_IN = 'Lnet/neoforged/api/distmarker/OnlyIn;';
const SUBSCRIBE = 'Lnet/neoforged/bus/api/SubscribeEvent;';
const EVENT_BASE = 'net/neoforged/bus/api/Event';
/** Классы, которых нет на выделенном сервере: RuntimeDistCleaner не даёт их загрузить («invalid dist DEDICATED_SERVER») */
const CLIENT_CLS = /^(net\/minecraft\/client|net\/neoforged\/neoforge\/client|com\/mojang\/blaze3d)\//;
const isClientName = (n) => CLIENT_CLS.test(n) || /\/client\//.test(n);
const onlyInClient = (anns) => anns.some((x) => x.type === ONLY_IN && JSON.stringify(x.values).includes('CLIENT'));
const ebsClient = (c) =>
  c.annotations.some(
    (x) =>
      /EventBusSubscriber;$/.test(x.type) &&
      JSON.stringify(x.values.value ?? '').includes('CLIENT') &&
      !JSON.stringify(x.values.value ?? '').includes('DEDICATED'),
  );
/** События, которые приходят и для клиентского мира (ClientLevel, сущности на клиенте) — в одиночной игре и в «мире хоста» их ловят оба */
const BOTH_SIDES =
  /^net\/neoforged\/neoforge\/event\/(level\/LevelEvent|entity\/EntityJoinLevelEvent|entity\/EntityLeaveLevelEvent|tick\/(EntityTickEvent|LevelTickEvent|PlayerTickEvent))(\$|$)/;
const bothSides = (ev) => superChain(ev).some((x) => BOTH_SIDES.test(x.name));
const isEventClass = (n) => n !== EVENT_BASE && superChain(n).some((x) => x.name === EVENT_BASE);

/** Чей код: «клиент (…)» / «событие X — и клиент, и сервер» / null (не определить по коду) */
function sideOf(c, m) {
  if (onlyInClient(c.annotations)) return 'клиент: @OnlyIn(CLIENT) на классе';
  if (m && onlyInClient(m.annotations)) return 'клиент: @OnlyIn(CLIENT)';
  if (ebsClient(c)) return 'клиент: @EventBusSubscriber(Dist.CLIENT)';
  if (isClientName(c.name)) return 'клиент: пакет client';
  if (!m) return null;
  const params = descClasses(m.desc);
  const cl = params.find(isClientName);
  if (cl) return `клиент: параметр ${javaName(cl)}`;
  // Обработчик события: @SubscribeEvent или метод с одним параметром-событием (addListener(this::onX))
  const isEvent = params.length === 1 && (m.annotations.some((x) => x.type === SUBSCRIBE) || isEventClass(params[0]));
  if (isEvent) {
    if (bothSides(params[0])) return `обе стороны: событие ${javaName(params[0])} приходит и для клиентского мира`;
    return `событие ${javaName(params[0])}`;
  }
  return null;
}

/** Ссылки класса на клиентские классы: owner → Set(где) — по коду методов и сигнатурам */
function clientRefsOf(c) {
  const out = new Map();
  const add = (owner, at) => {
    if (owner === c.name || owner.startsWith(`${c.name}$`)) return;
    if (!out.has(owner)) out.set(owner, new Set());
    out.get(owner).add(at);
  };
  for (const f of c.fields) for (const t of descClasses(f.desc)) if (isClientName(t)) add(t, `поле ${f.name}`);
  for (const m of c.methods) {
    const at = methodShort(m.name, m.desc);
    for (const t of descClasses(m.desc)) if (isClientName(t)) add(t, at);
    for (const r of codeRefs(c, m)) {
      if (r.owner && isClientName(r.owner)) add(r.owner, `${at}${r.line ? `:${r.line}` : ''}`);
    }
  }
  return out;
}

/** Предупреждение «на выделенном сервере»: класс общий, но тянет клиентские классы */
function clientWarning(c, forMixin) {
  if (onlyInClient(c.annotations) || isClientName(c.name)) return [];
  const refs = clientRefsOf(c);
  if (!refs.size) return [];
  const list = [...refs]
    .slice(0, 8)
    .map(([o, at]) => `${javaName(o)} (${[...at].slice(0, 3).join(', ')}${at.size > 3 ? '…' : ''})`);
  return [
    `⚠ ссылается на классы только клиента: ${list.join('; ')}${refs.size > 8 ? ` … ещё ${refs.size - 8}` : ''}.`,
    forMixin
      ? '  Миксин, который переписывает этот класс на выделенном сервере, может его уронить: при пересчёте фреймов Mixin грузит типы из этих мест — «Attempted to load class net/minecraft/client/… for invalid dist DEDICATED_SERVER». Миксин держите в разделе client конфига или не трогайте методы с клиентскими типами.'
      : '  Сам класс на сервере грузится, пока эти места не выполняются; но миксин на него (или вызов этих методов) на выделенном сервере может упасть с «invalid dist DEDICATED_SERVER».',
  ];
}

// ---------------------------------------------------------------- class_find

function classFind(a) {
  const q = String(a.query ?? '').trim();
  if (!q) throw new Error('пустой запрос');
  const idx = classIndex();
  const jar = anyJar(a.jar);
  let test;
  if (/[*?]/.test(q)) {
    const re = new RegExp(
      `^${q
        .replaceAll('/', '.')
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '§§')
        .replace(/\*/g, '[^.]*')
        .replace(/\?/g, '.')
        .replace(/§§/g, '.*')}$`,
      'i',
    );
    // Без точки — по простому имени (*Furnace*), с точкой — по полному
    test = q.includes('.') || q.includes('/') ? (r) => re.test(dotted(r.name)) : (r) => re.test(javaName(r.name));
  } else {
    const low = q.toLowerCase().replaceAll('/', '.');
    test = (r) => dotted(r.name).toLowerCase().includes(low);
  }
  const want = a.kind ? String(a.kind).toLowerCase() : null;
  let list = idx.all.filter((r) => (!jar || r.jar === jar) && test(r) && (a.platform || jar || r.jar !== PLATFORM));
  if (a.mixin) list = list.filter((r) => r.mixin);
  if (want)
    list = list.filter((r) => {
      const k = r.mixin ? 'mixin' : classKind({ access: r.access, superName: r.super });
      return k.includes(want);
    });
  // Сначала точное простое имя, потом короче
  const simple = q.toLowerCase();
  list.sort(
    (x, y) =>
      (javaName(y.name).toLowerCase() === simple) - (javaName(x.name).toLowerCase() === simple) ||
      x.name.length - y.name.length ||
      (x.name < y.name ? -1 : 1),
  );
  const hidden = !a.platform && !jar ? idx.all.filter((r) => r.jar === PLATFORM && test(r)).length : 0;
  const out = page(
    list,
    a,
    (r) => {
      const kind = r.mixin
        ? `mixin → ${r.mixin.map((t) => javaName(t)).join(', ')}`
        : `${classKind({ access: r.access, superName: r.super })}${r.super && r.super !== 'java/lang/Object' && r.super !== 'java/lang/Enum' && r.super !== 'java/lang/Record' ? ` extends ${javaName(r.super)}` : ''}`;
      return [`${dotted(r.name)} — ${kind} — ${where(r.jar)}`];
    },
    30,
  );
  return hidden ? `${out}\nВ Minecraft + NeoForge ещё ${hidden} — platform=true.` : out;
}

// ---------------------------------------------------------------- class_info

function lineRange(m) {
  if (!m.lines?.length) return '';
  const ls = m.lines.map((x) => x[1]);
  const lo = Math.min(...ls);
  const hi = Math.max(...ls);
  return lo === hi ? ` :${lo}` : ` :${lo}–${hi}`;
}

function classInfo(a) {
  const jar = anyJar(a.jar);
  const name = oneClass(a.class, jar);
  const rec = classRecord(name, jar);
  const c = readClass(rec);
  const idx = classIndex();
  const others = (idx.byName.get(name) ?? []).filter((r) => r.jar !== rec.jar);
  const out = [];
  const mods = modifiers(c.access & ~ACC.SYNCHRONIZED);
  out.push(
    `${dotted(name)} — ${mods ? `${mods} ` : ''}${classKind(c)} (Java ${c.major - 44}${c.source ? `, ${c.source}` : ''}) — ${where(rec.jar)}`,
  );
  if (others.length) out.push(`тот же класс ещё в: ${others.map((r) => where(r.jar)).join('; ')}`);
  const chain = superChain(name).slice(1);
  if (chain.length)
    out.push(
      `extends ${chain
        .map(
          (s) =>
            `${javaName(s.name)}${s.rec ? (s.rec.jar !== rec.jar ? ` [${modOf(s.rec.jar)}]` : '') : isRuntimeClass(s.name) ? '' : ' [нет в сборке]'}`,
        )
        .join(' ← ')}`,
    );
  if (c.interfaces.length) out.push(`implements ${c.interfaces.map((i) => javaName(i)).join(', ')}`);
  if (c.signature?.includes('<')) out.push(`generic: ${short(c.signature, 300)}`);
  for (const an of c.annotations) out.push(annotationText(an));
  if (rec.mixin) {
    const reg = mixinRegistry().byClass.get(name);
    out.push(
      `это миксин → ${rec.mixin.map(dotted).join(', ')}; ${reg ? `конфиг ${reg.config} (${reg.side})` : 'НЕ указан ни в одном конфиге миксинов — не применяется'} — подробно: mixins class="${dotted(name)}"`,
    );
  }
  const mx = idx.mixinsOf.get(name) ?? [];
  if (mx.length) {
    const by = new Map();
    for (const r of mx) by.set(modOf(r.jar), [...(by.get(modOf(r.jar)) ?? []), javaName(r.name)]);
    out.push(
      `миксины на этот класс: ${mx.length} — ${[...by].map(([m, l]) => `${m}: ${l.join(', ')}`).join('; ')} — mixins target="${dotted(name)}"`,
    );
  }
  const subs = idx.subs.get(name) ?? [];
  if (subs.length) out.push(`прямых наследников/реализаций: ${subs.length} — class_hierarchy`);
  if (onlyInClient(c.annotations) || isClientName(name)) out.push('сторона: только клиент (пакет client или @OnlyIn)');
  else out.push(...clientWarning(c, mx.length > 0));

  const re = a.members ? userRegex(a.members) : null;
  const showSynth = Boolean(a.synthetic);
  const fields = c.fields.filter((f) => (!re || re.test(f.name)) && (showSynth || !(f.access & ACC.SYNTHETIC)));
  const methods = c.methods.filter((m) => (!re || re.test(m.name)) && (showSynth || !(m.access & ACC.SYNTHETIC)));
  out.push(`поля (${fields.length}${re ? ` по «${a.members}»` : ''} из ${c.fields.length}):`);
  for (const f of fields) {
    const anns = f.annotations.map(annotationText).join(' ');
    const mods = modifiers(f.access);
    const val = f.constant !== undefined ? ` = ${JSON.stringify(f.constant)}` : '';
    out.push(`  ${anns ? `${anns} ` : ''}${mods ? `${mods} ` : ''}${fieldType(f.desc)} ${f.name}${val}`);
  }
  out.push(`методы (${methods.length}${re ? ` по «${a.members}»` : ''} из ${c.methods.length}):`);
  for (const m of methods) {
    const anns = m.annotations.map(annotationText).join(' ');
    out.push(`  ${anns ? `${anns} ` : ''}${methodSig(m, name)}${lineRange(m)}`);
  }
  out.push('Строки (:N–M) — номера строк исходника из байткода: по ним сверяется стек краша. Код метода — decompile.');
  return clip(out.join('\n'));
}

// ---------------------------------------------------------------- class_hierarchy

function classHierarchy(a) {
  const jar = anyJar(a.jar);
  const name = oneClass(a.class, jar);
  const dir = String(a.direction ?? 'both');
  const out = [`${dotted(name)} — ${where(classRecord(name, jar).jar)}`];
  if (dir !== 'down') {
    out.push('Предки:');
    for (const [i, s] of superChain(name).entries()) {
      if (!i) continue;
      const loc = s.rec ? modOf(s.rec.jar) : isRuntimeClass(s.name) ? 'JDK/библиотека' : 'нет в сборке';
      out.push(`  ${'  '.repeat(i - 1)}↑ ${dotted(s.name)} [${loc}]`);
    }
    // Все интерфейсы, включая унаследованные
    const ifaces = new Map();
    const walk = (n, from) => {
      const r = classRecord(n);
      if (!r) return;
      for (const i of r.ifaces) {
        if (!ifaces.has(i)) ifaces.set(i, from);
        walk(i, from);
      }
      if (r.super) walk(r.super, javaName(r.super));
    };
    walk(name, 'сам');
    if (ifaces.size)
      out.push(
        `Интерфейсы (${ifaces.size}): ${[...ifaces].map(([i, from]) => `${javaName(i)}${from !== 'сам' ? ` (через ${from})` : ''}`).join(', ')}`,
      );
  }
  if (dir === 'up') return out.join('\n');
  const depth = Math.max(1, Number(a.depth ?? 20) | 0);
  const subs = subtypes(name).filter((s) => s.depth <= depth && (a.platform || s.rec.jar !== PLATFORM));
  // Дерево: дети сразу под родителем
  const kids = new Map();
  for (const s of subs) kids.set(s.via, [...(kids.get(s.via) ?? []), s]);
  const ordered = [];
  const visit = (n) => {
    for (const s of (kids.get(n) ?? []).sort((x, y) => (x.rec.name < y.rec.name ? -1 : 1))) {
      ordered.push(s);
      visit(s.rec.name);
    }
  };
  visit(name);
  const hidden = subtypes(name).filter((s) => s.depth <= depth && !a.platform && s.rec.jar === PLATFORM).length;
  out.push(`Наследники и реализации${hidden ? ` (без ${hidden} из Minecraft — platform=true)` : ''}:`);
  out.push(
    page(
      ordered,
      a,
      (s) => [
        `${'  '.repeat(s.depth)}${isInterface(s.rec) ? '◇' : '↓'} ${dotted(s.rec.name)}${s.rec.mixin ? ' (mixin)' : ''} [${modOf(s.rec.jar)}]`,
      ],
      100,
    ),
  );
  return out.join('\n');
}

// ---------------------------------------------------------------- code_refs

/** Разбор цели поиска: { kind: 'class'|'member'|'string', owner?, owners?, name?, desc?, value? } */
function parseTarget(a) {
  const t = String(a.target ?? '').trim();
  if (!t) throw new Error('пустая цель');
  const kind = a.kind ? String(a.kind) : null;
  if (kind === 'string' || /^["'].*["']$/.test(t)) return { kind: 'string', value: t.replace(/^["']|["']$/g, '') };
  // Owner#name, Owner::name, Owner.name(…), *.name
  const m =
    t.match(/^(.+?)(?:#|::)([\w$<>]+)(\(.*)?$/) ??
    (kind !== 'class' ? t.match(/^(.+)\.([a-z_$<][\w$<>]*)(\(.*)?$/) : null) ??
    (kind === 'method' || kind === 'field' ? [t, '*', t, null] : null);
  if (m && kind !== 'class') {
    const [, ownerQ, name, desc] = m;
    let owner = null;
    if (ownerQ !== '*') {
      try {
        owner = oneClass(ownerQ);
      } catch (e) {
        if (!kind && !/[#:(]/.test(t)) return { kind: 'class', owner: oneClass(t) };
        throw e;
      }
    }
    return { kind: 'member', owner, name, desc: desc && desc.length > 2 ? desc : null, only: kind };
  }
  return { kind: 'class', owner: oneClass(t) };
}

function refsScan(target, a) {
  const jar = anyJar(a.jar);
  const jars = jar ? [jar] : allJars().filter((j) => a.platform || j !== PLATFORM);
  const owners = target.owner ? new Set([target.owner]) : null;
  if (owners && a.subtypes) for (const s of subtypes(target.owner)) owners.add(s.rec.name);
  // Быстрый отсев по байтам пула констант
  const needles = [];
  if (target.kind === 'string') needles.push(Buffer.from(target.value));
  else if (target.kind === 'member') needles.push(Buffer.from(target.name));
  if (target.owner && !a.subtypes) needles.push(Buffer.from(target.owner));
  const access = a.access ? String(a.access) : null;
  if (access && !['read', 'write'].includes(access)) throw new Error('access — read или write');
  const ownerDesc = target.owner ? `L${target.owner};` : null;
  const ownerDots = target.owner ? dotted(target.owner) : null;
  const hits = [];
  const idx = classIndex();
  for (const j of jars) {
    for (const e of jarToc(j)) {
      if (!e.name.endsWith('.class') || e.name.startsWith('META-INF/')) continue;
      const buf = readEntry(j, e.name).data;
      if (!needles.every((n) => buf.includes(n))) continue;
      let c;
      try {
        c = parseClassFull(buf);
      } catch {
        continue;
      }
      if (target.kind === 'class' && c.name === target.owner && !a.self) continue;
      const at = (m, r) => `${dotted(c.name)}.${m ? methodShort(m.name, m.desc) : ''}${r?.line ? `:${r.line}` : ''}`;
      const add = (loc, what, m, extra) =>
        hits.push({ jar: j, cls: c.name, loc, what, side: a.side === false ? null : sideOf(c, m), ...extra });
      if (target.kind === 'class') {
        if (c.superName === target.owner) add(dotted(c.name), 'extends');
        if (c.interfaces.includes(target.owner)) add(dotted(c.name), 'implements');
        for (const an of c.annotations) {
          const txt = JSON.stringify(an.values);
          if (txt.includes(ownerDesc) || txt.includes(ownerDots) || txt.includes(`"${target.owner}"`))
            add(dotted(c.name), annotationText(an));
        }
        for (const f of c.fields)
          if (descClasses(f.desc).includes(target.owner))
            add(`${dotted(c.name)}.${f.name}`, `поле ${fieldType(f.desc)}`);
        for (const m of c.methods) {
          if (descClasses(m.desc).includes(target.owner)) add(at(m), 'в сигнатуре', m);
          const seen = new Set();
          for (const r of codeRefs(c, m)) {
            if (r.owner !== target.owner) continue;
            const what =
              r.kind === 'class'
                ? r.op
                : `${r.op} ${javaName(r.owner)}.${r.kind === 'field' ? r.name : methodShort(r.name, r.desc)}`;
            const key = `${r.line}|${what}`;
            if (seen.has(key)) continue;
            seen.add(key);
            add(at(m, r), what, m);
          }
        }
      } else if (target.kind === 'member') {
        for (const m of c.methods)
          for (const r of codeRefs(c, m)) {
            if (r.kind !== 'method' && r.kind !== 'field' && r.kind !== 'lambda') continue;
            if (r.name !== target.name || (owners && !owners.has(r.owner))) continue;
            if (target.desc && !r.desc.startsWith(target.desc)) continue;
            if (target.only === 'field' && r.kind !== 'field') continue;
            if (target.only === 'method' && r.kind === 'field') continue;
            const write = r.kind === 'field' && r.op.startsWith('put');
            if (access && (r.kind !== 'field' || (access === 'write') !== write)) continue;
            const what =
              r.kind === 'field'
                ? `${write ? 'ЗАПИСЬ' : 'чтение'} (${r.op}) ${javaName(r.owner)}.${r.name}`
                : `${r.kind === 'lambda' ? `ссылка (${r.via})` : r.op} ${javaName(r.owner)}.${methodShort(r.name, r.desc)}`;
            add(at(m, r), what, m, { access: r.kind === 'field' ? (write ? 'write' : 'read') : null });
          }
      } else {
        const v = target.value;
        for (const m of c.methods)
          for (const r of codeRefs(c, m))
            if (r.kind === 'string' && r.value.includes(v))
              add(at(m, r), `${r.op} ${JSON.stringify(short(r.value, 200))}`, m);
        for (const f of c.fields)
          if (typeof f.constant === 'string' && f.constant.includes(v))
            add(`${dotted(c.name)}.${f.name}`, `константа ${JSON.stringify(short(f.constant, 200))}`);
        const annHits = (anns, loc) => {
          for (const an of anns)
            if (JSON.stringify(an.values).includes(JSON.stringify(v).slice(1, -1))) add(loc, annotationText(an));
        };
        annHits(c.annotations, dotted(c.name));
        for (const m of c.methods) annHits(m.annotations, at(m));
        for (const f of c.fields) annHits(f.annotations, `${dotted(c.name)}.${f.name}`);
      }
    }
  }
  return { hits, jars: jars.length, idx };
}

function codeRefsTool(a) {
  const target = parseTarget(a);
  const t0 = Date.now();
  const { hits, jars } = refsScan(target, a);
  const label =
    target.kind === 'string'
      ? `строка «${target.value}»`
      : target.kind === 'class'
        ? `класс ${dotted(target.owner)}`
        : `${target.owner ? dotted(target.owner) : '*'}.${target.name}${target.desc ?? ''}${a.subtypes ? ' (и наследники владельца)' : ''}`;
  const byMod = new Map();
  for (const h of hits) byMod.set(modOf(h.jar), (byMod.get(modOf(h.jar)) ?? 0) + 1);
  const head = [
    `Ссылки на ${label}: ${hits.length} в ${jars} jar за ${Date.now() - t0} мс${a.platform ? '' : ' (без Minecraft — platform=true)'}.`,
  ];
  if (byMod.size > 1)
    head.push(
      `По модам: ${[...byMod]
        .sort((x, y) => y[1] - x[1])
        .map(([m, n]) => `${m} ${n}`)
        .join(', ')}`,
    );
  const reads = hits.filter((h) => h.access === 'read').length;
  const writes = hits.filter((h) => h.access === 'write').length;
  if (reads || writes)
    head.push(`Поле: запись ${writes}, чтение ${reads}${a.access ? '' : ' (access=write — только запись)'}.`);
  const client = hits.filter((h) => h.side?.startsWith('клиент')).length;
  const both = hits.filter((h) => h.side?.startsWith('обе')).length;
  if (client || both)
    head.push(
      `Сторона: из клиентского кода ${client}, из обработчиков событий, которые приходят и на клиент, ${both}. В одиночной игре и «мире хоста» клиент и встроенный сервер — один процесс: статические поля у них общие.`,
    );
  return `${head.join('\n')}\n${page(hits, a, (h) => [`${modOf(h.jar)}: ${h.loc} — ${h.what}${h.side ? ` [${h.side}]` : ''}`], 40)}`;
}

// ---------------------------------------------------------------- event_listeners

const KUBE_HANDLER = /^Ldev\/latvian\/mods\/kubejs\/event\/(Targeted)?EventHandler;$/;
const kubeNames = new Map(); // класс групп событий KubeJS → Map(поле → «PlayerEvents.loggedIn»)

/** Имена событий KubeJS по статическому инициализатору класса групп: GROUP = EventGroup.of("X"); Y = GROUP.server("y", …) */
function kubeEventNames(owner) {
  if (kubeNames.has(owner)) return kubeNames.get(owner);
  const out = new Map();
  kubeNames.set(owner, out);
  const rec = classRecord(owner);
  if (!rec) return out;
  const c = readClass(rec);
  const init = c.methods.find((m) => m.name === '<clinit>');
  if (!init) return out;
  let group = null;
  let last = null;
  for (const r of codeRefs(c, init)) {
    if (r.kind === 'string' && r.op !== 'concat') last = r.value;
    else if (r.kind === 'field' && r.op === 'putstatic' && r.owner === owner) {
      if (r.desc === 'Ldev/latvian/mods/kubejs/event/EventGroup;') group = last;
      else if (KUBE_HANDLER.test(r.desc) && last) out.set(r.name, `${group ?? javaName(owner)}.${last}`);
      last = null;
    }
  }
  return out;
}

/** События KubeJS, которые разносит этот метод (и его лямбды): getstatic XxxEvents.FIELD → «Group.name» */
function kubeEventsPosted(c, m) {
  const out = new Set();
  const scan = (mm, depth) => {
    for (const r of codeRefs(c, mm)) {
      if (r.kind === 'field' && r.op === 'getstatic' && KUBE_HANDLER.test(r.desc)) {
        const n = kubeEventNames(r.owner).get(r.name);
        if (n) out.add(n);
      }
      // Тело лямбды в том же классе
      if (depth < 2 && r.kind === 'lambda' && r.owner === c.name) {
        const body = c.methods.find((x) => x.name === r.name && x.desc === r.desc);
        if (body && body !== mm) scan(body, depth + 1);
      }
    }
  };
  scan(m, 0);
  return [...out];
}

function eventListeners(a) {
  // Одинаковые простые имена (EntityTickEvent у NeoForge и у мода) — берём тот, что наследует Event
  let found = findClasses(a.event).filter(isEventClass);
  if (found.length > 1 && found.filter((n) => n.startsWith('net/neoforged/')).length === 1)
    found = found.filter((n) => n.startsWith('net/neoforged/'));
  const ev = found.length === 1 ? found[0] : oneClass(a.event);
  const others = findClasses(a.event).filter((n) => n !== ev && !n.includes('$') === !ev.includes('$'));
  const chain = superChain(ev);
  const isEvent = chain.some((x) => x.name === EVENT_BASE);
  const targets = new Map([[ev, 'само']]);
  for (const x of chain.slice(1))
    if (x.name !== EVENT_BASE && x.name !== 'java/lang/Object') targets.set(x.name, `предок ${javaName(x.name)}`);
  if (a.subtypes !== false) for (const x of subtypes(ev)) targets.set(x.rec.name, `наследник ${javaName(x.rec.name)}`);
  const t0 = Date.now();
  const jars = allJars().filter((j) => a.platform || j !== PLATFORM);
  const needles = [Buffer.from('SubscribeEvent'), Buffer.from('addListener')];
  const names = [...targets.keys()].map((n) => Buffer.from(n));
  const hits = [];
  for (const j of jars)
    for (const e of jarToc(j)) {
      if (!e.name.endsWith('.class') || e.name.startsWith('META-INF/')) continue;
      const buf = readEntry(j, e.name).data;
      if (!needles.some((n) => buf.includes(n)) || !names.some((n) => buf.includes(n))) continue;
      let c;
      try {
        c = parseClassFull(buf);
      } catch {
        continue;
      }
      const ebs = c.annotations.find((x) => /EventBusSubscriber;$/.test(x.type));
      for (const m of c.methods) {
        const sub = m.annotations.find((x) => x.type === SUBSCRIBE);
        if (sub) {
          const p0 = descClasses(m.desc)[0];
          if (p0 && targets.has(p0)) {
            const opts = Object.entries(sub.values)
              .map(([k, v]) => `${k}=${valueText(v)}`)
              .join(', ');
            hits.push({
              jar: j,
              c,
              m,
              ev: p0,
              how: `@SubscribeEvent${opts ? `(${opts})` : ''}${ebs ? ` в ${annotationText(ebs)}` : ''}`,
              loc: `${dotted(c.name)}.${methodShort(m.name, m.desc)}${lineRange(m)}`,
            });
          }
        }
        // addListener(…, Consumer): событие — из ldc Класс.class перед вызовом или из параметров лямбды/ссылки
        const refs = codeRefs(c, m);
        let from = 0;
        for (let i = 0; i < refs.length; i++) {
          const r = refs[i];
          if (r.kind !== 'method' || r.name !== 'addListener') continue;
          const win = refs.slice(from, i);
          from = i + 1;
          const ldc = win.filter((x) => x.kind === 'class' && x.op.startsWith('ldc') && targets.has(x.owner)).at(-1);
          const lam = win.filter((x) => x.kind === 'lambda').at(-1);
          const evc = ldc?.owner ?? (lam ? descClasses(lam.desc).find((x) => targets.has(x)) : null);
          if (!evc) continue;
          const body =
            lam && lam.owner === c.name ? c.methods.find((x) => x.name === lam.name && x.desc === lam.desc) : null;
          hits.push({
            jar: j,
            c,
            m: body ?? m,
            ev: evc,
            how: `addListener в ${methodShort(m.name, m.desc)}${r.line ? `:${r.line}` : ''}`,
            loc: lam
              ? `${dotted(lam.owner)}.${lam.name}${body ? lineRange(body) : ''}`
              : `${dotted(c.name)}.${methodShort(m.name, m.desc)}`,
          });
        }
      }
    }
  // Скрипты KubeJS: прямые подписки (NativeEvents.onEvent, Java.loadClass с именем класса) и события KubeJS, которые
  // разносят обработчики самого KubeJS из списка выше
  const kube = [];
  if (a.kubejs !== false) {
    const variants = new Set();
    for (const n of targets.keys()) {
      const simple = n.slice(n.lastIndexOf('/') + 1);
      variants.add(simple);
      variants.add(simple.replaceAll('$', '.'));
    }
    const vs = [...variants].map((v) => new RegExp(`\\b${v.replaceAll('$', '\\$').replaceAll('.', '\\.')}\\b`));
    for (const l of scriptLines((t) => vs.some((re) => re.test(t))))
      kube.push({ ...l, why: 'класс события в скрипте' });
    const posted = new Map();
    for (const h of hits)
      if (/kubejs/.test(jarOwner(h.jar))) for (const n of kubeEventsPosted(h.c, h.m)) posted.set(n, h);
    for (const [n] of posted) {
      const re = new RegExp(`\\b${n.replace('.', '\\.')}\\s*\\(`);
      for (const l of scriptLines((t) => re.test(t))) kube.push({ ...l, why: `событие KubeJS ${n}` });
    }
    if (posted.size)
      kube.unshift({ note: `KubeJS разносит это событие скриптам как: ${[...posted.keys()].join(', ')}` });
  }
  const out = [
    `${dotted(ev)}${isEvent ? '' : ' — ⚠ не наследник net.neoforged.bus.api.Event: это точно событие?'} — обработчиков: ${hits.length} в ${jars.length} jar за ${Date.now() - t0} мс${a.platform ? '' : ' (без Minecraft+NeoForge — platform=true)'}.`,
    ...(others.length && !String(a.event).includes('.')
      ? [`(есть и другие классы с этим именем: ${others.slice(0, 3).map(dotted).join(', ')} — укажите полное имя)`]
      : []),
    `Учтены ${targets.size} классов: само событие${targets.size > 1 ? ', предки (их обработчики получают и это событие)' : ''}${a.subtypes !== false && subtypes(ev).length ? ', наследники (subtypes=false — без них)' : ''}.`,
  ];
  if (bothSides(ev))
    out.push(
      'Это событие приходит и для клиентского мира: в одиночной игре и «мире хоста» его ловят и клиент, и встроенный сервер.',
    );
  const body = page(
    hits,
    a,
    (h) => {
      const side = sideOf(h.c, h.m);
      return [
        `${modOf(h.jar)}: ${h.loc} — ${h.how}${h.ev !== ev ? ` [${targets.get(h.ev)}]` : ''}${side?.startsWith('клиент') ? ` [${side}]` : ''}`,
      ];
    },
    60,
  );
  out.push(body);
  if (a.kubejs !== false) {
    const lines = kube.filter((k) => !k.note);
    out.push(`Скрипты KubeJS: ${lines.length}${kube[0]?.note ? `. ${kube[0].note}` : ''}`);
    for (const k of lines.slice(0, 40)) out.push(`  ${k.rel}:${k.line} (${k.why}): ${short(k.text, 200)}`);
    if (lines.length > 40) out.push(`  … ещё ${lines.length - 40} — kubejs_search`);
  }
  out.push(
    'Код обработчика — decompile class=… method=…; порядок вызова — priority (HIGHEST → LOWEST), receiveCanceled.',
  );
  return clip(out.join('\n'));
}

// ---------------------------------------------------------------- миксины

const MIXIN_PKG = /^L(org\/spongepowered\/asm\/mixin|com\/llamalad7\/mixinextras)\//;
const NOT_INJECTOR =
  /\/(Shadow|Unique|Final|Mutable|Dynamic|Intrinsic|Debug|Local|Share|Cancellable|Coerce|Desc|At|Slice)\b/;

/** «Lnet/minecraft/world/level/Level;setBlock(…)Z» → «Level.setBlock(BlockPos, BlockState, int)» */
function shortTarget(s) {
  const m = String(s).match(/^L([^;]+);([\w$<>*]+)(\(.*)?$/);
  if (m) {
    if (m[3]) return `${javaName(m[1])}.${methodShort(m[2], m[3])}`;
    return `${javaName(m[1])}.${m[2]}`;
  }
  const f = String(s).match(/^L([^;]+);([\w$]+):(.+)$/);
  if (f) return `${javaName(f[1])}.${f[2]}`;
  const d = String(s).match(/^([\w$<>*]+)(\(.*)$/);
  if (d) return methodShort(d[1], d[2]);
  return String(s);
}

/** Имя целевого метода из «method» миксина: tick, tick(…)V, Lowner;tick(…)V → tick */
const targetMethodName = (s) =>
  String(s)
    .replace(/^L[^;]+;/, '')
    .replace(/\(.*$/, '')
    .replace(/:.*$/, '');

function atText(at) {
  if (!at?.ann) return '';
  const v = at.ann.values;
  const parts = [v.value ?? '?'];
  if (v.target) parts.push(shortTarget(v.target));
  if (v.ordinal !== undefined) parts.push(`ordinal=${v.ordinal}`);
  if (v.shift) parts.push(`shift=${valueText(v.shift)}`);
  return parts.join(' ');
}

/** Инжекторы миксина: [{ ann, handler, targets: [имя метода], text, kind, atTarget }] */
function injectors(c) {
  const out = [];
  for (const m of c.methods)
    for (const an of m.annotations) {
      if (!MIXIN_PKG.test(an.type) || NOT_INJECTOR.test(an.type)) continue;
      const kind = javaName(an.type.slice(1, -1));
      const v = an.values;
      let targets = [v.method ?? []].flat().map(String);
      if (kind === 'Overwrite') targets = [m.name];
      if ((kind === 'Accessor' || kind === 'Invoker') && !targets.length) {
        const raw = typeof v.value === 'string' && v.value ? v.value : m.name.replace(/^(get|set|is|call|invoke)/, '');
        targets = [raw.charAt(0).toLowerCase() + raw.slice(1)];
      }
      const ats = [v.at ?? []].flat();
      const extra = [];
      if (ats.length) extra.push(`at ${ats.map(atText).join(' | ')}`);
      if (v.cancellable) extra.push('cancellable');
      if (v.require !== undefined) extra.push(`require=${v.require}`);
      if (v.constant) extra.push(`constant=${valueText(v.constant)}`);
      if (v.index !== undefined) extra.push(`index=${v.index}`);
      if (v.ordinal !== undefined) extra.push(`ordinal=${v.ordinal}`);
      if (v.remap === false) extra.push('remap=false');
      out.push({
        kind,
        handler: m.name,
        targets: targets.map(targetMethodName),
        rawTargets: targets,
        atTarget: ats.map((x) => x?.ann?.values?.target).filter(Boolean),
        text: `@${kind} ${targets.map(shortTarget).join(', ') || '?'}${extra.length ? ` ${extra.join(', ')}` : ''} ← ${m.name}`,
      });
    }
  return out;
}

let registryCache = null;
/** Все конфиги миксинов сборки: класс миксина → конфиг; проблемы конфигов */
function mixinRegistry() {
  const idx = classIndex();
  if (registryCache?.idx === idx) return registryCache;
  const byClass = new Map();
  const configs = [];
  for (const jar of idx.jars) {
    if (jar === PLATFORM) continue;
    const meta = jarMeta(jar);
    for (const mc of meta.mixinConfigs) {
      const cfg = mixinConfig(jar, mc.file);
      configs.push({ jar, declared: mc.declared, ...(cfg ?? { file: mc.file, missing: true, mixins: [] }) });
      for (const m of cfg?.mixins ?? [])
        if (mc.declared)
          byClass.set(m.cls, {
            jar,
            config: mc.file,
            side: m.side,
            priority: cfg.priority,
            plugin: cfg.plugin,
            required: cfg.required,
          });
    }
  }
  registryCache = { idx, byClass, configs };
  return registryCache;
}

const exists = (idx, n) => idx.byName.has(n) || isRuntimeClass(n);

function mixinsTool(a) {
  const idx = classIndex();
  const reg = mixinRegistry();
  const methodRe = a.method ? new RegExp(`^(${a.method})$`, 'i') : null;

  // Один миксин целиком
  if (a.class) {
    const name = oneClass(a.class, anyJar(a.jar));
    const rec = classRecord(name);
    if (!rec.mixin) return `${dotted(name)} — не миксин (нет @Mixin).`;
    const c = readClass(rec);
    const r = reg.byClass.get(name);
    const out = [
      `${dotted(name)} — ${where(rec.jar)}`,
      `цели: ${rec.mixin.map((t) => `${dotted(t)}${exists(idx, t) ? '' : ' [НЕТ В СБОРКЕ]'}`).join(', ')}`,
      r
        ? `конфиг ${r.config} (${r.side}), priority ${rec.priority ?? r.priority}${r.plugin ? `, плагин ${r.plugin} (может отключить)` : ''}${r.required ? ', required (ошибка инжекта — краш)' : ''}${rec.pseudo ? ', @Pseudo' : ''}`
        : 'ни в одном объявленном конфиге — не применяется',
    ];
    const inj = injectors(c);
    out.push(`инжекторы (${inj.length}):`, ...inj.map((x) => `  ${x.text}`));
    const shadows =
      c.methods.filter((m) => m.annotations.some((x) => /\/Shadow;$/.test(x.type))).length +
      c.fields.filter((f) => f.annotations.some((x) => /\/Shadow;$/.test(x.type))).length;
    if (shadows) out.push(`@Shadow: ${shadows}`);
    out.push('Код — decompile.');
    return out.join('\n');
  }

  // Миксины на класс: по целевым методам, с возможными конфликтами
  if (a.target) {
    let name;
    try {
      name = oneClass(a.target);
    } catch (e) {
      // Цели может не быть в сборке — ищем по строке среди целей миксинов
      const want = String(a.target).replaceAll('.', '/');
      const keys = [...idx.mixinsOf.keys()].filter((k) => k === want || k.endsWith(`/${want}`));
      if (keys.length !== 1) throw e;
      name = keys[0];
    }
    const recs = [...(idx.mixinsOf.get(name) ?? [])].filter((r) => a.platform || r.jar !== PLATFORM);
    // Миксины на предков: их инжекторы тоже действуют на унаследованные методы
    const parents = superChain(name)
      .slice(1)
      .filter((s) => idx.mixinsOf.has(s.name));
    const out = [`${dotted(name)}${exists(idx, name) ? '' : ' [класса нет в сборке]'} — миксинов: ${recs.length}`];
    const tRec = classRecord(name);
    if (tRec) out.push(...clientWarning(readClass(tRec), true));
    if (!recs.length) {
      if (parents.length)
        out.push(
          `На предков: ${parents.map((s) => `${javaName(s.name)} (${idx.mixinsOf.get(s.name).length})`).join(', ')} — mixins target=<предок>.`,
        );
      return out.join('\n');
    }
    const byMethod = new Map();
    const lines = [];
    for (const r of recs) {
      const c = readClass(r);
      const cfg = reg.byClass.get(r.name);
      const prio = r.priority ?? cfg?.priority ?? 1000;
      // С фильтром method — только миксины, у которых есть инжектор в эти методы
      const inj = injectors(c).filter((x) => !methodRe || x.targets.some((t) => methodRe.test(t)));
      if (methodRe && !inj.length) continue;
      lines.push(
        `${modOf(r.jar)}: ${dotted(r.name)} — priority ${prio}${cfg ? `, ${cfg.config} (${cfg.side})${cfg.plugin ? ', с плагином' : ''}` : ', НЕ В КОНФИГЕ — не применяется'}`,
      );
      for (const x of inj) {
        lines.push(`    ${x.text}`);
        for (const t of x.targets)
          byMethod.set(t, [...(byMethod.get(t) ?? []), { ...x, mod: modOf(r.jar), mixin: javaName(r.name) }]);
      }
    }
    // Возможные конфликты: @Overwrite, два @Redirect одного вызова, несколько модов в одном методе
    const warn = [];
    for (const [m, list] of byMethod) {
      const mods = new Set(list.map((x) => x.mod));
      const ow = list.filter((x) => x.kind === 'Overwrite');
      if (ow.length > 1)
        warn.push(`⚠ ${m}: @Overwrite у ${ow.map((x) => `${x.mod}/${x.mixin}`).join(' и ')} — применится один`);
      else if (ow.length && mods.size > 1)
        warn.push(
          `⚠ ${m}: @Overwrite (${ow[0].mod}/${ow[0].mixin}) и инжекторы других модов (${[...mods].filter((x) => x !== ow[0].mod).join(', ')}) — зависит от priority`,
        );
      const redirects = new Map();
      for (const x of list.filter((y) => y.kind === 'Redirect'))
        for (const t of x.atTarget.length ? x.atTarget : ['?']) redirects.set(t, [...(redirects.get(t) ?? []), x]);
      for (const [t, rs] of redirects)
        if (rs.length > 1)
          warn.push(
            `⚠ ${m}: @Redirect одного вызова ${shortTarget(t)} у ${rs.map((x) => `${x.mod}/${x.mixin}`).join(' и ')} — второй не применится (краш при require≥1)`,
          );
      if (mods.size > 1 && !warn.some((w) => w.startsWith(`⚠ ${m}:`)))
        warn.push(`· ${m}: ${mods.size} мода (${[...mods].join(', ')}) — ${list.map((x) => `@${x.kind}`).join(', ')}`);
    }
    if (warn.length) out.push('Методы, в которые лезут несколько модов:', ...warn);
    if (parents.length)
      out.push(
        `Ещё миксины на предков: ${parents.map((s) => `${javaName(s.name)} (${idx.mixinsOf.get(s.name).length})`).join(', ')}.`,
      );
    out.push('Миксины по модам:');
    return clip([...out, ...lines].join('\n'));
  }

  // Миксины мода / jar
  if (a.mod || a.jar) {
    const jar = resolveJar(a.mod ?? a.jar, true);
    const jars = [jar, ...nestedJars().filter((n) => n.startsWith(`${jar}!`))];
    const recs = idx.all.filter((r) => r.mixin && jars.includes(r.jar));
    const out = [`${where(jar)} — классов-миксинов: ${recs.length}`];
    for (const cfg of reg.configs.filter((x) => jars.includes(x.jar))) {
      const missing = cfg.mixins.filter((m) => !idx.byName.has(m.cls));
      out.push(
        `конфиг ${cfg.file}${cfg.declared ? ` (из ${cfg.declared})` : ' — НЕ ОБЪЯВЛЕН в mods.toml/MANIFEST, не применяется'}${cfg.missing ? ' — ФАЙЛА НЕТ' : ''}: ${cfg.mixins.length} миксинов, priority ${cfg.priority ?? 1000}${cfg.plugin ? `, плагин ${cfg.plugin}` : ''}${cfg.required ? ', required (ошибка инжекта — краш)' : ''}${cfg.defaultRequire !== null && cfg.defaultRequire !== undefined ? `, defaultRequire ${cfg.defaultRequire}` : ''}${missing.length ? `; классов нет: ${missing.map((m) => javaName(m.cls)).join(', ')}` : ''}`,
      );
    }
    const rows = recs
      .map((r) => ({ r, missing: r.pseudo ? [] : r.mixin.filter((t) => !exists(idx, t)) }))
      .sort((x, y) => y.missing.length - x.missing.length || (x.r.name < y.r.name ? -1 : 1));
    return `${out.join('\n')}\n${page(
      rows,
      a,
      ({ r, missing }) => [
        `${dotted(r.name)} → ${r.mixin.map((t) => `${javaName(t)}${missing.includes(t) ? ' [НЕТ В СБОРКЕ]' : ''}`).join(', ')}${reg.byClass.has(r.name) ? '' : ' — не в конфиге'}`,
      ],
      60,
    )}`;
  }

  // Обзор: горячие цели (куда лезут несколько модов) и цели, которых нет в сборке
  const hot = [];
  for (const [t, rs] of idx.mixinsOf) {
    const mods = new Set(rs.filter((r) => r.jar !== PLATFORM && reg.byClass.has(r.name)).map((r) => modOf(r.jar)));
    if (mods.size > 1) hot.push({ t, mods, n: rs.length });
  }
  hot.sort((x, y) => y.mods.size - x.mods.size || y.n - x.n);
  // Цели без класса — только у миксинов из объявленных конфигов (необъявленные, например для Fabric, не применяются)
  // и без @Pseudo. Mixin 0.8.7 (MixinInfo.getTargetClass) на такое пишет WARN и пропускает миксин — не краш.
  const missing = [];
  for (const r of idx.all) {
    const cfg = r.mixin && !r.pseudo && reg.byClass.get(r.name);
    if (cfg) for (const t of r.mixin) if (!exists(idx, t)) missing.push({ r, t, cfg });
  }
  missing.sort((x, y) => (modOf(x.r.jar) < modOf(y.r.jar) ? -1 : modOf(x.r.jar) > modOf(y.r.jar) ? 1 : 0));
  const undeclared = reg.configs.filter((c) => !c.declared);
  const out = [
    `Миксинов в сборке: ${idx.all.filter((r) => r.mixin).length}, в объявленных конфигах: ${reg.byClass.size}, конфигов: ${reg.configs.length}.`,
    `Целей нет в сборке: ${missing.length} (без @Pseudo). Это не краш: Mixin пишет в лог «@Mixin target … was not found» и пропускает миксин — обычно совместимость с модом, которого нет. Краш даёт другое: цель есть, а инжект не нашёл метод/вызов в конфиге required (log_analyze).`,
    ...missing
      .slice(0, 30)
      .map(
        ({ r, t, cfg }) =>
          `  ${modOf(r.jar)}: ${javaName(r.name)} → ${dotted(t)} (${cfg.config}${cfg.plugin ? ', с плагином' : ''})`,
      ),
    ...(missing.length > 30 ? [`  … ещё ${missing.length - 30} — mixins mod=…`] : []),
  ];
  if (undeclared.length)
    out.push(
      `Конфиги, не объявленные в mods.toml/MANIFEST (не применяются; часто это конфиги для Fabric в jar на несколько загрузчиков): ${undeclared.map((c) => `${modOf(c.jar)}: ${c.file}`).join(', ')}`,
    );
  out.push('Классы, в которые лезут миксины нескольких модов (mixins target=… — по методам и конфликты):');
  out.push(
    page(hot, a, (h) => [`${dotted(h.t)} — ${h.mods.size} мод.: ${[...h.mods].join(', ')} (${h.n} миксинов)`], 30),
  );
  return clip(out.join('\n'));
}

// ---------------------------------------------------------------- decompile

function decompiler() {
  if (process.env.TFC_DECOMPILER) return process.env.TFC_DECOMPILER;
  const dir = path.join(os.homedir(), '.gradle/caches/modules-2/files-2.1/org.vineflower/vineflower');
  if (!fs.existsSync(dir)) return null;
  const found = [];
  for (const v of fs.readdirSync(dir))
    for (const h of fs.readdirSync(path.join(dir, v))) {
      const f = path.join(dir, v, h, `vineflower-${v}.jar`);
      if (fs.existsSync(f)) found.push({ v, f });
    }
  found.sort((x, y) => compareVersions(x.v, y.v));
  return found.at(-1)?.f ?? null;
}

function javaBin() {
  const jdk = path.join(os.homedir(), '.gradle/local-tools/jdk21/Contents/Home/bin/java');
  return fs.existsSync(jdk) ? jdk : 'java';
}

const run = (cmd, args, timeout) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { maxBuffer: 64 << 20, timeout }, (err, stdout, stderr) =>
      err
        ? reject(
            new Error(
              String(stderr || err.message)
                .trim()
                .split('\n')
                .slice(-5)
                .join('\n'),
            ),
          )
        : resolve(stdout),
    ),
  );

/** Исходник внешнего класса: Minecraft — из -sources.jar, моды — Vineflower с кешем в .cache/mcp/decompile */
async function sourceOf(rec) {
  const outer = rec.path.replace(/\.class$/, '').split('$')[0];
  if (rec.jar === PLATFORM && platform()?.sources) {
    const r = readEntry(PLATFORM_SOURCES, `${outer}.java`);
    if (r)
      return {
        text: r.data.toString('utf8'),
        via: `исходники NeoForge ${platform().version} (как в среде разработки; номера строк могут не совпадать с игрой)`,
      };
  }
  const vf = decompiler();
  if (!vf)
    throw new Error(
      'нет декомпилятора: Vineflower ищется в ~/.gradle/caches (сборка аддона) или TFC_DECOMPILER; есть jar_javap',
    );
  const file = jarFile(rec.jar);
  const sig = `${fs.statSync(file).mtimeMs}`;
  const base = path.join(CACHE, 'decompile', rec.jar.replace(/[^\w.-]+/g, '_'));
  const out = path.join(base, `${outer}.java`);
  if (fs.existsSync(out) && fs.readFileSync(`${out}.sig`, 'utf8') === sig)
    return { text: fs.readFileSync(out, 'utf8'), via: `Vineflower (кеш)` };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tfc-vf-'));
  try {
    const inDir = path.join(tmp, 'in');
    for (const e of jarToc(rec.jar))
      if (e.name === `${outer}.class` || e.name.startsWith(`${outer}$`)) {
        const dst = path.join(inDir, e.name);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, readEntry(rec.jar, e.name).data);
      }
    const libs = [`-e=${file}`];
    if (platform()) libs.push(`-e=${platform().classes}`);
    await run(javaBin(), ['-jar', vf, '-dgs=1', '-log=WARN', '-mpm=60', ...libs, inDir, path.join(tmp, 'out')], 180000);
    const res = path.join(tmp, 'out', `${outer}.java`);
    if (!fs.existsSync(res)) throw new Error('Vineflower не выдал файл');
    const text = fs.readFileSync(res, 'utf8');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text);
    fs.writeFileSync(`${out}.sig`, sig);
    return { text, via: 'Vineflower' };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Блок от строки start до закрывающей скобки (по балансу {}), без учёта строк и комментариев — для исходника хватает */
function blockFrom(lines, start) {
  let depth = 0;
  let opened = false;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i].replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\/\/.*$/g, '')) {
      if (ch === '{') {
        depth++;
        opened = true;
      } else if (ch === '}') depth--;
    }
    if (opened && depth <= 0) return [start, i];
    if (!opened && /;\s*$/.test(lines[i])) return [start, i]; // abstract / interface
  }
  return [start, lines.length - 1];
}

async function decompileTool(a) {
  const jar = anyJar(a.jar);
  const name = oneClass(a.class, jar);
  const rec = classRecord(name, jar);
  const { text, via } = await sourceOf(rec);
  let lines = text.replace(/\r/g, '').split('\n');
  let numbered = lines.map((l, i) => [i + 1, l]);
  const notes = [];
  // Вложенный класс (не анонимный): только его блок
  const inner = name.split('$').slice(1);
  if (inner.length && !/^\d+$/.test(inner.at(-1))) {
    const simple = inner.at(-1);
    const i = lines.findIndex((l) =>
      new RegExp(`\\b(class|interface|enum|record)\\s+${simple.replace(/\$/g, '\\$')}\\b`).test(l),
    );
    if (i >= 0) {
      const [s, e] = blockFrom(lines, i);
      numbered = numbered.slice(s, e + 1);
    }
  }
  if (a.method) {
    const re = new RegExp(
      `^\\s*(?:@[\\w.]+(?:\\(.*\\))?\\s+)*(?:(?:public|protected|private|static|final|abstract|synchronized|native|default|strictfp)\\s+)*(?:<[^>]+>\\s+)?(?:[\\w.$<>\\[\\],? ]+\\s+)?(${a.method})\\s*\\(`,
    );
    const blocks = [];
    for (let k = 0; k < numbered.length; k++) {
      const l = numbered[k][1];
      if (!re.test(l) || /^\s*(return|new|else|if|for|while)\b/.test(l) || /[;=]\s*$/.test(l.split('(')[0])) continue;
      // Аннотации над методом — тоже в вывод
      let s = k;
      while (s > 0 && /^\s*@/.test(numbered[s - 1][1])) s--;
      const [, e] = blockFrom(
        numbered.map((x) => x[1]),
        k,
      );
      blocks.push(...numbered.slice(s, e + 1), [0, '']);
      k = e;
    }
    if (!blocks.length) return `В ${dotted(name)} нет метода «${a.method}» в исходнике (${via}). Методы — class_info.`;
    numbered = blocks;
  }
  if (a.grep) {
    const re = userRegex(a.grep);
    numbered = numbered.filter(([, l]) => re.test(l));
  }
  // Номера строк исходника из байткода — чтобы сверять со стеком краша (у Vineflower свои номера строк)
  if (rec.jar !== PLATFORM) {
    const c = readClass(rec);
    const withLines = c.methods.filter(
      (m) => m.lines?.length && (!a.method || new RegExp(`^(${a.method})$`).test(m.name)),
    );
    if (withLines.length)
      notes.push(
        `строки исходного кода мода по методам (для стека краша): ${withLines
          .slice(0, 40)
          .map((m) => `${m.name}${lineRange(m)}`)
          .join(', ')}${withLines.length > 40 ? ' …' : ''}`,
      );
  }
  const offset = Math.max(0, Number(a.offset ?? 0) | 0);
  const limit = Math.min(2000, Math.max(1, Number(a.limit ?? 400) | 0));
  const part = numbered.slice(offset, offset + limit);
  const end = offset + part.length;
  const head = `${dotted(name)} — ${where(rec.jar)}; ${via}; ${numbered.length} строк${a.method ? ` (метод ${a.method})` : ''}${a.grep ? ` по «${a.grep}»` : ''}; показаны ${offset + 1}–${end}${end < numbered.length ? `; дальше: offset=${end}` : ''}`;
  return clip([head, ...notes, ...part.map(([n, l]) => (n ? `${n}: ${l}` : '…'))].join('\n'));
}

// ---------------------------------------------------------------- jar_grep

const BINARY =
  /\.(class|png|jpe?g|gif|ogg|wav|nbt|jar|zip|dat|mca|ttf|otf|bin|so|dll|dylib|jnilib|bmp|ico|psd|blend|bbmodel)$/i;

function jarGrep(a) {
  const q = String(a.query ?? '');
  if (!q) throw new Error('пустой запрос');
  const test = textTest(q, { regex: a.regex });
  // Быстрый отсев по байтам — для простого ASCII-запроса без «|»
  const pre = !a.regex && !q.includes('|') && /^[\x20-\x7e]*$/.test(q) ? q.trim().toLowerCase() : null;
  const match = a.path ? pathMatcher(a.path) : null;
  const jars = a.jar ? [resolveJar(a.jar, true)] : [...jarList(), ...(a.nested ? nestedJars() : [])];
  const ctx = Math.min(5, Math.max(0, Number(a.context ?? 0) | 0));
  const hits = [];
  const files = new Set();
  const MAXHITS = 3000;
  const t0 = Date.now();
  outer: for (const jar of jars)
    for (const e of jarToc(jar)) {
      if (BINARY.test(e.name) || (match && !match(e.name))) continue;
      if (e.size > (match ? 16 << 20 : 2 << 20)) continue;
      const data = readEntry(jar, e.name).data;
      if (pre && !data.toString('latin1').toLowerCase().includes(pre)) continue;
      const text = data.toString('utf8');
      if (text.includes('\u0000')) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!test(lines[i])) continue;
        files.add(`${jar}:${e.name}`);
        const from = Math.max(0, i - ctx);
        const to = Math.min(lines.length - 1, i + ctx);
        hits.push({
          jar,
          file: e.name,
          line: i + 1,
          text: lines
            .slice(from, to + 1)
            .map((l, k) =>
              ctx ? `${from + k + 1 === i + 1 ? '>' : ' '} ${short(l.trim(), 240)}` : short(l.trim(), 240),
            ),
        });
        if (hits.length >= MAXHITS) break outer;
      }
    }
  const head = `«${q}»: ${hits.length >= MAXHITS ? `≥${MAXHITS}` : hits.length} строк в ${files.size} файлах, ${jars.length} jar, ${Date.now() - t0} мс${a.nested || a.jar ? '' : ' (без вложенных jar — nested=true)'}. Классы не просматриваются — для кода code_refs.`;
  return `${head}\n${page(hits, a, (h) => (ctx ? [`${modOf(h.jar)}: ${h.file}:${h.line}`, ...h.text] : [`${modOf(h.jar)}: ${h.file}:${h.line}: ${h.text[0]}`]), 40)}`;
}

// ---------------------------------------------------------------- mods_check

/** Все моды сборки: id → [{ id, version, name, jar, nested }] — jar модов и вложенные (jar-in-jar) */
function modUniverse() {
  const present = new Map();
  for (const jar of [...jarList(), ...nestedJars()]) {
    const meta = jarMeta(jar);
    for (const m of meta.mods)
      present.set(m.id, [...(present.get(m.id) ?? []), { ...m, jar, nested: jar.includes('!') }]);
  }
  return present;
}

/** Выбранная версия мода: верхний уровень, иначе самая новая из вложенных (так выбирает JarJar) */
function chosen(list) {
  const top = list.filter((x) => !x.nested);
  const pool = top.length ? top : list;
  return [...pool].sort((x, y) => compareVersions(y.version, x.version))[0];
}

function modsCheck(a) {
  const present = modUniverse();
  const mc = String(a.minecraft ?? '1.21.1');
  const nf = a.neoforge ? String(a.neoforge) : null;
  const version = (id) =>
    id === 'minecraft' ? mc : id === 'neoforge' ? nf : (chosen(present.get(id) ?? [])?.version ?? null);
  const active = [];
  for (const [id, list] of present) {
    const c = chosen(list);
    active.push({ id, ...c, jarMeta: jarMeta(c.jar) });
  }
  const depsOf = (m) => m.jarMeta.deps.filter((d) => d.owner === m.id);
  // FML (VersionSupportMatrix, loader 4.0.42): на Minecraft 1.21.1 зависимость от minecraft засчитывается, если
  // диапазон включает 1.21, от neoforge — если включает 21.0.166; версия «0.0NONE» подходит к любому диапазону
  const fits = (id, v, range) =>
    v === '0.0NONE' ||
    inRange(v, range) ||
    (mc === '1.21.1' &&
      ((id === 'minecraft' && inRange('1.21', range)) || (id === 'neoforge' && inRange('21.0.166', range))));
  const check = (d) => {
    const v = version(d.id);
    const has = v !== null || (d.id === 'neoforge' && !nf);
    if (d.id === 'neoforge' && !nf) return { status: 'unknown', v };
    if (d.type === 'required') {
      if (!has) return { status: 'missing', v };
      return fits(d.id, v, d.range) ? { status: 'ok', v } : { status: 'version', v };
    }
    if (d.type === 'optional')
      return !has ? { status: 'absent', v } : fits(d.id, v, d.range) ? { status: 'ok', v } : { status: 'version', v };
    if (d.type === 'incompatible')
      return has && fits(d.id, v, d.range) ? { status: 'incompatible', v } : { status: 'ok', v };
    if (d.type === 'discouraged')
      return has && fits(d.id, v, d.range) ? { status: 'discouraged', v } : { status: 'ok', v };
    return { status: 'ok', v };
  };
  const SAY = {
    missing: 'нет мода',
    version: 'не та версия',
    incompatible: 'несовместим и стоит',
    discouraged: 'не рекомендуется вместе',
    absent: 'нет (необязательный)',
    ok: 'ок',
    unknown: 'версия NeoForge не задана (neoforge=…)',
  };
  const depLine = (m, d) => {
    const r = check(d);
    return `${d.type} ${d.id} ${d.range}${d.side !== 'BOTH' ? ` [${d.side === 'CLIENT' ? 'только клиент' : 'только сервер'}]` : ''} → ${r.v ?? '—'}: ${SAY[r.status]}${d.reason ? ` (${d.reason})` : ''}`;
  };

  if (a.mod) {
    const id = String(a.mod);
    let list = present.get(id);
    if (!list) {
      const jar = resolveJar(id, true);
      const ids = jarMeta(jar).mods.map((m) => m.id);
      if (!ids.length) return `${where(jar)} — не мод (библиотека без neoforge.mods.toml).`;
      list = present.get(ids[0]);
    }
    const c = chosen(list);
    const m = active.find((x) => x.id === c.id);
    const out = [`${c.id} — ${c.name} ${c.version} — ${c.jar}${c.nested ? ' (вложен в другой jar)' : ''}`];
    if (list.length > 1)
      out.push(`копии: ${list.map((x) => `${x.version} в ${x.jar}`).join('; ')} → берётся ${c.version}`);
    const deps = depsOf(m);
    out.push(`зависимости (${deps.length}):`, ...deps.map((d) => `  ${depLine(m, d)}`));
    const rev = [];
    for (const o of active) for (const d of depsOf(o)) if (d.id === c.id) rev.push(`  ${o.id}: ${depLine(o, d)}`);
    out.push(`от него зависят (${rev.length}):`, ...rev);
    const nested = nestedJars().filter((n) => n.startsWith(`${c.jar}!`));
    if (nested.length)
      out.push(
        `несёт внутри (jar-in-jar): ${nested.map((n) => `${n.slice(n.lastIndexOf('/') + 1)} (${jarOwner(n)})`).join(', ')}`,
      );
    const meta = jarMeta(c.jar);
    if (meta.mixinConfigs.length)
      out.push(`конфиги миксинов: ${meta.mixinConfigs.map((x) => x.file).join(', ')} — mixins mod="${c.id}"`);
    if (meta.accessTransformers.length) out.push(`access transformers: ${meta.accessTransformers.join(', ')}`);
    return out.join('\n');
  }

  const problems = [];
  let nfMin = null;
  for (const m of active)
    for (const d of depsOf(m)) {
      if (d.id === 'neoforge') {
        const lo = rangeMin(d.range);
        if (lo && (!nfMin || compareVersions(lo, nfMin.v) > 0)) nfMin = { v: lo, by: m.id };
      }
      const r = check(d);
      if (['missing', 'version', 'incompatible', 'discouraged'].includes(r.status)) {
        if (a.side === 'server' && d.side === 'CLIENT') continue;
        if (a.side === 'client' && d.side === 'SERVER') continue;
        const sev = r.status === 'discouraged' || (r.status === 'missing' && d.side === 'CLIENT') ? '·' : '✗';
        problems.push(`${sev} ${m.id} ${m.version}: ${depLine(m, d)}`);
      }
    }
  // Один мод в двух jar верхнего уровня — FML не запустится
  for (const [id, list] of present) {
    const top = list.filter((x) => !x.nested);
    if (top.length > 1)
      problems.push(`✗ мод ${id} в нескольких jar: ${top.map((x) => `${x.jar} (${x.version})`).join(', ')}`);
  }
  // Одинаковые классы в разных jar верхнего уровня (вложенные JarJar выбирает сам)
  const idx = classIndex();
  const pairs = new Map();
  for (const [n, recs] of idx.byName) {
    const tops = [...new Set(recs.filter((r) => !r.jar.includes('!') && r.jar !== PLATFORM).map((r) => r.jar))];
    if (tops.length < 2) continue;
    const key = tops.sort().join(' + ');
    const p = pairs.get(key) ?? { n: 0, sample: n };
    p.n++;
    pairs.set(key, p);
  }
  for (const [key, p] of pairs) problems.push(`· одинаковые классы (${p.n}) в ${key}, например ${dotted(p.sample)}`);
  const head = [
    `Модов: ${present.size} (jar: ${jarList().length}, вложенных библиотек: ${nestedJars().length}); Minecraft ${mc}; NeoForge ${nf ?? 'не задан'}${nfMin ? `; минимум по модам — ${nfMin.v} (${nfMin.by})` : ''}.`,
    `Проблем: ${problems.filter((p) => p.startsWith('✗')).length} серьёзных (✗ — FML не запустится), ${problems.filter((p) => p.startsWith('·')).length} замечаний (·)${a.side ? `, сторона ${a.side}` : ''}. Правила — как в FML 4 (ModSorter): зависимости другой стороны не проверяются; dependencyOverrides из config/fml.toml не учтены.`,
  ];
  return `${head.join('\n')}\n${page(problems.sort(), a, (p) => [p], 60)}`;
}

// ---------------------------------------------------------------- список

export const TOOLS = [
  {
    name: 'class_find',
    description:
      'Поиск классов во всех jar сборки (с вложенными jar-in-jar; Minecraft+NeoForge — platform=true): часть имени, полное имя или glob (*Furnace*, net.dries007.tfc.**.Firepit*). Вид класса, родитель, jar и мод; у миксинов — цели.',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('часть имени, полное имя или glob'),
        jar: str('только этот jar: имя, часть, id мода, «minecraft»'),
        kind: str('class, interface, enum, record, abstract, mixin'),
        mixin: bool('только миксины'),
        platform: bool('искать и в Minecraft + NeoForge'),
        ...paging,
      },
      required: ['query'],
    },
    handler: classFind,
  },
  {
    name: 'class_info',
    description:
      'Класс по байткоду: jar и мод (и другие jar с тем же классом), цепочка предков, интерфейсы, аннотации, поля (с константами), методы с сигнатурами и диапазоном строк исходника (для стека краша), миксины на этот класс и наследники.',
    inputSchema: {
      type: 'object',
      properties: {
        class: str('класс: полное имя, через / или простое (если однозначно)'),
        jar: str('если класс есть в нескольких jar'),
        members: str('только поля и методы, чьё имя подходит под регулярку'),
        synthetic: bool('показывать синтетические (лямбды, мосты)'),
      },
      required: ['class'],
    },
    handler: classInfo,
  },
  {
    name: 'class_hierarchy',
    description:
      'Иерархия класса: предки (с модами) и все интерфейсы; вниз — дерево наследников и реализаций по всей сборке (кто расширяет Block, кто реализует интерфейс).',
    inputSchema: {
      type: 'object',
      properties: {
        class: str('класс или интерфейс'),
        direction: str('up, down или both (по умолчанию)'),
        depth: { type: 'integer', description: 'глубина вниз (20)' },
        platform: bool('наследники и в Minecraft + NeoForge'),
        jar: str('если класс есть в нескольких jar'),
        ...paging,
      },
      required: ['class'],
    },
    handler: classHierarchy,
  },
  {
    name: 'code_refs',
    description:
      'Кто использует по байткоду всех jar (метод:строка): класс (extends, new, вызовы, поля, сигнатуры, аннотации и цели миксинов), метод или поле (Owner#name, Owner.name, *#name — любой владелец; subtypes — и через наследников) или строку в коде ("tfc:metal/ingot", ключ конфига). У полей — запись/чтение (access=write — кто перезаписывает), у каждого места — сторона: клиент (пакет client, @OnlyIn, клиентское событие) или событие, которое приходит и для клиентского мира. ~3–5 с на всю сборку.',
    inputSchema: {
      type: 'object',
      properties: {
        target: str('класс, Owner#member или "строка"'),
        kind: str('class, method, field или string — если не понятно из записи'),
        jar: str('искать только в этом jar'),
        subtypes: bool('для метода/поля: вызовы через наследников владельца (виртуальные)'),
        platform: bool('искать и в Minecraft + NeoForge (долго, много совпадений)'),
        self: bool('для класса: включать сам класс (для метода/поля он и так в ответе)'),
        access: str('для поля: read — только чтение, write — только запись (putfield/putstatic)'),
        side: bool('false — не помечать сторону кода (клиент/обе стороны)'),
        ...paging,
      },
      required: ['target'],
    },
    handler: codeRefsTool,
  },
  {
    name: 'event_listeners',
    description:
      'Кто слушает событие NeoForge по всей сборке: методы @SubscribeEvent с этим событием (и с его предками/наследниками), addListener(…) с лямбдами и ссылками на методы, сторона кода; плюс скрипты KubeJS — NativeEvents.onEvent/Java.loadClass с этим классом и события KubeJS (PlayerEvents.loggedIn и т. п.), которые KubeJS разносит из своего обработчика. ~3–6 с.',
    inputSchema: {
      type: 'object',
      properties: {
        event: str(
          'класс события: EntityTravelToDimensionEvent, LevelEvent$Unload, net.neoforged….PlayerChangedDimensionEvent',
        ),
        subtypes: bool('false — без обработчиков наследников события (по умолчанию с ними)'),
        platform: bool('искать и в Minecraft + NeoForge'),
        kubejs: bool('false — без скриптов KubeJS'),
        ...paging,
      },
      required: ['event'],
    },
    handler: eventListeners,
  },
  {
    name: 'mixins',
    description:
      'Миксины сборки. target — все миксины на класс по методам (@Inject/@Redirect/@Overwrite/MixinExtras: куда, at, priority, конфиг) и возможные конфликты; class — один миксин целиком; mod/jar — миксины мода, конфиги, цели, которых нет в сборке; без параметров — обзор: цели без класса, необъявленные конфиги, классы под миксинами нескольких модов.',
    inputSchema: {
      type: 'object',
      properties: {
        target: str('целевой класс (net.minecraft.world.level.block.Block)'),
        method: str('с target: только инжекторы в эти методы (регулярка: tick|onPlace)'),
        class: str('класс-миксин'),
        mod: str('id мода или jar'),
        jar: str('jar (для mod/class)'),
        platform: bool('учитывать миксины внутри Minecraft+NeoForge'),
        ...paging,
      },
    },
    handler: mixinsTool,
  },
  {
    name: 'decompile',
    description:
      'Исходник класса: моды — декомпиляция Vineflower (кеш .cache/mcp/decompile), Minecraft+NeoForge — исходники среды разработки. method — только этот метод (регулярка), grep — строки. В шапке — строки исходника мода по методам (для сверки со стеком краша).',
    inputSchema: {
      type: 'object',
      properties: {
        class: str('класс (вложенный — через $ или точку)'),
        jar: str('если класс есть в нескольких jar'),
        method: str('имя метода или регулярка'),
        grep: str('только строки по регулярке'),
        offset: { type: 'integer', description: 'с какой строки' },
        limit: { type: 'integer', description: 'сколько строк (400)' },
      },
      required: ['class'],
    },
    handler: decompileTool,
  },
  {
    name: 'jar_grep',
    description:
      'Поиск текста по файлам всех jar (json, toml, mcmeta, lang, js, mixins.json, data/ и assets/), без классов: где упоминается id, ключ, путь. path — glob по пути (data/**/recipe/*.json), context — строк вокруг.',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('текст (без учёта регистра; «a|b» — любой из) или регулярка с regex=true'),
        regex: bool('query — регулярное выражение'),
        path: str('glob или часть пути файла внутри jar'),
        jar: str('только этот jar (в т. ч. вложенный или «minecraft»)'),
        nested: bool('искать и во вложенных jar'),
        context: { type: 'integer', description: 'строк контекста (0–5)' },
        ...paging,
      },
      required: ['query'],
    },
    handler: jarGrep,
  },
  {
    name: 'mods_check',
    description:
      'Проверка зависимостей сборки по neoforge.mods.toml всех jar (и вложенных): нет обязательного мода, не та версия, несовместимые вместе, мод в двух jar, одинаковые классы в разных jar, минимальная версия NeoForge. mod — зависимости одного мода, кто от него зависит, что он несёт внутри.',
    inputSchema: {
      type: 'object',
      properties: {
        mod: str('id мода или jar — подробно об одном'),
        neoforge: str('версия NeoForge сервера для проверки (например 21.1.248)'),
        minecraft: str('версия Minecraft (1.21.1)'),
        side: str('server или client — без зависимостей другой стороны'),
        ...paging,
      },
    },
    handler: modsCheck,
  },
];
