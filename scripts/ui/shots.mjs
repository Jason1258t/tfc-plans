#!/usr/bin/env node
// Скриншоты страниц для проверки рефакторинга стилей: десктоп и мобильный, до/после, картинка разницы.
// Без зависимостей: установленный Chrome/Chromium в headless через DevTools Protocol (WebSocket из Node 24).
//
//   node scripts/ui/shots.mjs capture before --url http://localhost:5176 [--only tasks,docs] [--out DIR]
//   node scripts/ui/shots.mjs capture after  --url http://localhost:5176 [--only tasks,docs]
//   node scripts/ui/shots.mjs diff before after [--threshold 0.1%]
//   node scripts/ui/shots.mjs list                       — сценарии из scripts/ui/scenarios.json
//
// Снимки лежат в DIR/<метка>/<сценарий>.<desktop|mobile>.png; DIR по умолчанию —
// $TMPDIR/tfc-shots/<ветка git>. Chrome — CHROME_PATH или стандартные пути.
import { spawn, execFileSync } from 'node:child_process';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
  mobile: {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  },
};

// Анимации, мигающий курсор и полосы прокрутки дают шум в разнице — выключаем
const FREEZE_CSS = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}
::-webkit-scrollbar{display:none}`;

// Запросы, которые не заканчиваются никогда: слушатели Firestore, HMR Vite, iframe reCAPTCHA (App Check)
const LONG_POLL = /\/Listen\/channel|\/Write\/channel|google\.firestore|__vite_ping|\/@vite\/|^wss?:|\/recaptcha\//;

// ── Chrome и DevTools Protocol ───────────────────────────────────
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error('Chrome не найден — укажи путь в CHROME_PATH');
  return found;
}

// Профиль занят живым Chrome: второй запуск с тем же --user-data-dir передаёт управление первому и молча выходит.
// Chrome держит символьную ссылку SingletonLock → «хост-pid»
function profileBusy(dir) {
  try {
    const [host, pid] = readlinkSync(join(dir, 'SingletonLock')).split(/-(?=\d+$)/);
    if (host !== hostname()) return false;
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Папка профиля. Постоянная (~/.cache/tfc-plans/shots-profile): тот же анонимный пользователь Firebase между
 * запусками. Если её держит другой запуск (параллельные агенты, «до» и «после» одновременно) — следующий слот
 * shots-profile-2…8; если ~/.cache недоступна для записи (песочница агента) — временная папка. TFC_SHOTS_PROFILE —
 * своя папка.
 */
function pickProfile() {
  if (process.env.TFC_SHOTS_PROFILE) return process.env.TFC_SHOTS_PROFILE;
  const base = join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'tfc-plans');
  for (let n = 1; n <= 8; n++) {
    const dir = join(base, n === 1 ? 'shots-profile' : `shots-profile-${n}`);
    try {
      mkdirSync(dir, { recursive: true });
      accessSync(dir, constants.W_OK);
    } catch {
      break;
    }
    if (!profileBusy(dir)) return dir;
  }
  return mkdtempSync(join(tmpdir(), 'tfc-shots-profile-'));
}

// Chrome живёт дольше скрипта, если того прервали (Ctrl+C, таймаут агента) — гасим его сами
const children = new Set();
const killChildren = () => {
  for (const p of children) p.kill();
};
process.on('exit', killChildren);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'])
  process.on(sig, () => {
    killChildren();
    process.exit(130);
  });

/** Запуск headless Chrome со своим профилем (см. pickProfile) */
export async function launchChrome({ profile } = {}) {
  const dir = profile ?? pickProfile();
  mkdirSync(dir, { recursive: true });
  const proc = spawn(
    findChrome(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${dir}`,
      '--no-first-run',
      '--no-default-browser-check',
      // Без них macOS просит пароль к «Chrome Safe Storage» в Связке ключей — агент упирается в системное окно
      '--use-mock-keychain',
      '--password-store=basic',
      '--hide-scrollbars',
      '--mute-audio',
      '--force-color-profile=srgb',
      '--font-render-hinting=none',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  children.add(proc);
  proc.on('exit', () => children.delete(proc));
  const wsUrl = await new Promise((ok, fail) => {
    let buf = '';
    const t = setTimeout(() => fail(new Error(`Chrome не ответил за 15 с:\n${buf}`)), 15000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) {
        clearTimeout(t);
        ok(m[1]);
      }
    });
    proc.on('exit', (code) =>
      fail(
        new Error(
          `Chrome завершился (${code}), профиль ${dir}${profileBusy(dir) ? ' занят другим Chrome — TFC_SHOTS_PROFILE=<своя папка>' : ''}:\n${buf}`,
        ),
      ),
    );
  });
  const browser = await connect(wsUrl);
  return {
    browser,
    async newPage() {
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
      const page = browser.session(sessionId);
      page.close = () => browser.send('Target.closeTarget', { targetId });
      return page;
    },
    async close() {
      await browser.send('Browser.close').catch(() => {});
      proc.kill();
    },
  };
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((ok, fail) => {
    ws.onopen = ok;
    ws.onerror = () => fail(new Error(`Нет соединения с ${url}`));
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail, method } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) fail(new Error(`${method}: ${msg.error.message}`));
      else ok(msg.result);
    } else if (msg.method) for (const l of listeners) l(msg);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((ok, fail) => {
      const mid = ++id;
      pending.set(mid, { ok, fail, method });
      ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const client = {
    send,
    session: (sessionId) => ({
      send: (method, params) => send(method, params, sessionId),
      once: (method, timeout = 30000) =>
        new Promise((ok, fail) => {
          const t = setTimeout(() => {
            listeners.delete(l);
            fail(new Error(`Не дождались ${method} за ${timeout / 1000} с`));
          }, timeout);
          const l = (m) => {
            if (m.sessionId === sessionId && m.method === method) {
              clearTimeout(t);
              listeners.delete(l);
              ok(m.params);
            }
          };
          listeners.add(l);
        }),
      on: (method, fn) => listeners.add((m) => m.sessionId === sessionId && m.method === method && fn(m.params)),
    }),
  };
  return client;
}

async function evaluate(page, expression) {
  const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

// Ждём, пока страница успокоится: шрифты, картинки и ни одной правки DOM за quietMs
const SETTLE = (quietMs, maxMs) => `new Promise((done) => {
  const start = performance.now();
  let last = performance.now();
  const mo = new MutationObserver(() => (last = performance.now()));
  mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const tick = async () => {
    await document.fonts.ready;
    const imgs = [...document.images].every((i) => i.complete);
    const now = performance.now();
    if ((imgs && now - last > ${quietMs}) || now - start > ${maxMs}) { mo.disconnect(); done(now - start > ${maxMs} ? 'timeout' : 'ok'); }
    else setTimeout(tick, 100);
  };
  tick();
})`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, selector, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await evaluate(page, `!!document.querySelector(${JSON.stringify(selector)})`)) return;
    await sleep(150);
  }
  throw new Error(`Не появился элемент ${selector}`);
}

async function runAction(page, a) {
  if (a.wait !== undefined) return typeof a.wait === 'number' ? sleep(a.wait) : waitFor(page, a.wait);
  if (a.click) {
    await waitFor(page, a.click);
    return evaluate(page, `document.querySelector(${JSON.stringify(a.click)}).click()`);
  }
  if (a.clickText) {
    // Кнопка/ссылка по видимому тексту: { clickText: "Схемы", within?: "header" }; счётчик в конце («Схемы 6»)
    // не мешает. Без within ждём до 10 с совпадения в окне или <main> (страница ещё грузится),
    // и только потом ищем по всей странице — иначе попадём в ссылку шапки с тем же словом.
    // within — тег/роль, не класс: классы модулей станут хэшами
    const tryClick = (roots) =>
      evaluate(
        page,
        `(() => {
          const match = (e) => [e.textContent.trim(), e.textContent.replace(/\\s*\\d+\\s*$/, '').trim()].includes(${JSON.stringify(a.clickText)});
          for (const sel of ${JSON.stringify(roots)}) {
            const root = document.querySelector(sel);
            const el = root && [...root.querySelectorAll('button,a,[role=tab],[role=button],summary,label')].find(match);
            if (el) { el.click(); return true; }
          }
          return false;
        })()`,
      );
    const roots = a.within ? [a.within] : ['[role=dialog]', 'main'];
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      if (await tryClick(roots)) return;
      await sleep(200);
    }
    if (!a.within && (await tryClick(['body']))) return;
    throw new Error(`Нет элемента с текстом «${a.clickText}»`);
  }
  if (a.type) {
    const [sel, text] = a.type;
    await waitFor(page, sel);
    await evaluate(page, `document.querySelector(${JSON.stringify(sel)}).focus()`);
    return page.send('Input.insertText', { text });
  }
  if (a.eval) return evaluate(page, a.eval);
  throw new Error(`Неизвестное действие: ${JSON.stringify(a)}`);
}

/** Один снимок: сценарий × вьюпорт → PNG (Buffer) */
export async function capture(chrome, { baseUrl, scenario, viewport, setup }) {
  const vp = VIEWPORTS[viewport];
  const page = await chrome.newPage();
  try {
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: vp.deviceScaleFactor,
      mobile: vp.mobile,
    });
    if (vp.mobile) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    if (vp.userAgent) await page.send('Emulation.setUserAgentOverride', { userAgent: vp.userAgent });
    await page.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: scenario.theme ?? setup.theme ?? 'light' }],
    });
    const url = new URL(scenario.path, baseUrl);
    for (const [name, value] of Object.entries(setup.cookies ?? {}))
      await page.send('Network.setCookie', { name, value, url: url.origin, path: '/' });
    // localStorage и стили — до скриптов страницы
    const storage = { ...setup.localStorage, ...scenario.localStorage };
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { for (const [k, v] of Object.entries(${JSON.stringify(storage)})) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch {}
        document.addEventListener('DOMContentLoaded', () => {
          const s = document.createElement('style'); s.textContent = ${JSON.stringify(FREEZE_CSS)}; document.head.appendChild(s);
        });`,
    });
    // Запросы в полёте: данные (каталоги, Firestore) догружаются после тишины в DOM —
    // без этого «до» и «после» снимаются на разных стадиях загрузки
    const inflight = new Map();
    let lastNet = Date.now();
    page.on('Network.requestWillBeSent', (p) => {
      if (LONG_POLL.test(p.request.url)) return;
      inflight.set(p.requestId, p.request.url);
      lastNet = Date.now();
    });
    const done = (p) => {
      if (inflight.delete(p.requestId)) lastNet = Date.now();
    };
    page.on('Network.loadingFinished', done);
    page.on('Network.loadingFailed', done);
    const loaded = page.once('Page.loadEventFired', 45000);
    await page.send('Page.navigate', { url: url.href });
    await loaded;
    if (scenario.waitFor) await waitFor(page, scenario.waitFor, 20000);
    for (const a of scenario.actions ?? []) await runAction(page, a);
    const maxWait = scenario.maxWaitMs ?? 15000;
    const netStart = Date.now();
    while ((inflight.size || Date.now() - lastNet < 500) && Date.now() - netStart < maxWait) await sleep(100);
    if (inflight.size && process.env.SHOTS_DEBUG)
      console.log('  висят запросы:', [...inflight.values()].join('\n    '));
    const settled = await evaluate(page, SETTLE(scenario.quietMs ?? 700, maxWait));
    // Меняющееся само по себе (время, счётчики онлайна) — закрашиваем, чтобы не мешало сравнению
    const mask = [...(setup.mask ?? []), ...(scenario.mask ?? [])];
    if (mask.length)
      await evaluate(
        page,
        `for (const el of document.querySelectorAll(${JSON.stringify(mask.join(','))})) { el.style.background = '#f0f'; el.style.color = 'transparent'; el.style.backgroundImage = 'none'; for (const c of el.children) c.style.visibility = 'hidden'; }`,
      );
    const fullPage = scenario.fullPage ?? true;
    const { data } = await page.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: fullPage,
      ...(fullPage ? {} : { clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale: 1 } }),
    });
    return { png: Buffer.from(data, 'base64'), settled };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Сравнение двух PNG прямо в Chrome (canvas): доля отличающихся пикселей и картинка разницы —
 * исходник бледно, отличия красным. tolerance — допуск на канал (0–255), против сглаживания.
 */
export async function diffPng(chrome, a, b, { tolerance = 24 } = {}) {
  const page = await chrome.newPage();
  try {
    return await evaluate(
      page,
      `(async () => {
        const load = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
        const [A, B] = await Promise.all([load('data:image/png;base64,${a.toString('base64')}'), load('data:image/png;base64,${b.toString('base64')}')]);
        const w = Math.max(A.width, B.width), h = Math.max(A.height, B.height);
        const px = (img) => { const c = new OffscreenCanvas(w, h), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
        const da = px(A), db = px(B);
        const out = new OffscreenCanvas(w, h), ox = out.getContext('2d'), od = ox.createImageData(w, h);
        let changed = 0, minY = h, maxY = -1;
        for (let i = 0; i < da.length; i += 4) {
          const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
          if (d > ${tolerance}) {
            changed++; od.data[i] = 230; od.data[i + 1] = 20; od.data[i + 2] = 20; od.data[i + 3] = 255;
            const y = (i / 4 / w) | 0; if (y < minY) minY = y; if (y > maxY) maxY = y;
          } else {
            const g = 255 - (255 - (db[i] + db[i + 1] + db[i + 2]) / 3) * 0.25;
            od.data[i] = od.data[i + 1] = od.data[i + 2] = g; od.data[i + 3] = 255;
          }
        }
        ox.putImageData(od, 0, 0);
        const blob = await out.convertToBlob({ type: 'image/png' });
        const buf = new Uint8Array(await blob.arrayBuffer());
        let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return { changed, total: w * h, sizeA: [A.width, A.height], sizeB: [B.width, B.height], rows: maxY < 0 ? null : [minY, maxY], png: btoa(bin) };
      })()`,
    );
  } finally {
    await page.close().catch(() => {});
  }
}

// ── CLI ──────────────────────────────────────────────────────────
function loadScenarios(file) {
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  return { setup: cfg.setup ?? {}, scenarios: cfg.scenarios };
}

function defaultOut() {
  let branch = 'main';
  try {
    branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    /* не git — общая папка */
  }
  return join(tmpdir(), 'tfc-shots', branch.replace(/[^\w.-]+/g, '_'));
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (name, def) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : def;
  };
  const VALUE = new Set(['--url', '--only', '--out', '--scenarios', '--viewports', '--threshold', '--tolerance']);
  const pos = argv.filter((a, i) => !a.startsWith('--') && !VALUE.has(argv[i - 1]));
  const [cmd, ...rest] = pos;
  const scenariosFile = resolve(opt('--scenarios', join(HERE, 'scenarios.json')));
  const outDir = resolve(opt('--out', defaultOut()));
  const { setup, scenarios } = loadScenarios(scenariosFile);

  if (cmd === 'list') {
    for (const s of scenarios) console.log(`${s.name.padEnd(22)} ${s.path}${s.note ? `  — ${s.note}` : ''}`);
    return;
  }

  if (cmd === 'capture') {
    const label = rest[0];
    if (!label) throw new Error('Нужна метка: capture before | capture after');
    const baseUrl = opt('--url', 'http://localhost:5176');
    const only = opt('--only')?.split(',');
    const viewports = (opt('--viewports') ?? 'desktop,mobile').split(',');
    const list = only
      ? scenarios.filter((s) => only.some((o) => s.name === o || s.name.startsWith(`${o}.`)))
      : scenarios;
    if (!list.length) throw new Error(`Нет сценариев под --only ${only}; список: shots.mjs list`);
    try {
      await fetch(baseUrl);
    } catch {
      throw new Error(`Дев-сервер не отвечает на ${baseUrl} — запусти npm run dev -- --port 5176 --strictPort`);
    }
    const dir = join(outDir, label);
    mkdirSync(dir, { recursive: true });
    const chrome = await launchChrome();
    let failed = 0;
    try {
      for (const scenario of list)
        for (const viewport of scenario.viewports ?? viewports) {
          const file = join(dir, `${scenario.name}.${viewport}.png`);
          try {
            const { png, settled } = await capture(chrome, { baseUrl, scenario, viewport, setup });
            writeFileSync(file, png);
            console.log(
              `✓ ${scenario.name}.${viewport}${settled === 'timeout' ? '  (страница не успокоилась — возможен шум)' : ''}`,
            );
          } catch (e) {
            failed++;
            console.log(`✗ ${scenario.name}.${viewport}: ${e.message}`);
          }
        }
    } finally {
      await chrome.close();
    }
    console.log(`\nСнимки: ${dir}`);
    if (failed) process.exitCode = 1;
    return;
  }

  if (cmd === 'diff') {
    const [a = 'before', b = 'after'] = rest;
    const dirA = join(outDir, a);
    const dirB = join(outDir, b);
    const diffDir = join(outDir, `diff-${a}-${b}`);
    mkdirSync(diffDir, { recursive: true });
    const threshold = parseFloat(opt('--threshold', '0.1')); // % пикселей
    const tolerance = Number(opt('--tolerance', 24));
    const names = readdirSync(dirA).filter((f) => f.endsWith('.png'));
    const chrome = await launchChrome();
    let bad = 0;
    try {
      for (const f of names) {
        if (!existsSync(join(dirB, f))) {
          console.log(`?  ${f}: нет снимка «${b}»`);
          bad++;
          continue;
        }
        const r = await diffPng(chrome, readFileSync(join(dirA, f)), readFileSync(join(dirB, f)), { tolerance });
        const pct = (r.changed / r.total) * 100;
        const size =
          r.sizeA.join('×') === r.sizeB.join('×') ? '' : `  размер ${r.sizeA.join('×')} → ${r.sizeB.join('×')}`;
        const ok = pct <= threshold && !size;
        if (!ok) {
          bad++;
          writeFileSync(join(diffDir, f), Buffer.from(r.png, 'base64'));
        }
        const rows = r.rows ? `  строки ${r.rows[0]}–${r.rows[1]}` : '';
        console.log(`${ok ? '✓' : '✗'}  ${f}: ${pct.toFixed(3)}%${size}${ok ? '' : rows}`);
      }
    } finally {
      await chrome.close();
    }
    console.log(bad ? `\nОтличия: ${bad}; картинки разницы (красное — изменилось): ${diffDir}` : '\nОтличий нет.');
    if (bad) process.exitCode = 1;
    return;
  }

  console.log(
    readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('\n')
      .slice(1, 12)
      .join('\n')
      .replace(/^\/\/ ?/gm, ''),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
