import { Check, Copy, Download, Terminal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cx } from '@/shared/lib';

/** public/tfc/version.json — его пишет npm run tfc:dist */
interface TfcVersion {
  version: string;
  time: number;
  files: Record<string, { file: string; size: number; sha256: string }>;
  /** Пакет npm tfc-plans (tfc.tgz); в старых version.json его нет */
  npm?: { file: string; version: string; size: number };
}

type Os = 'win' | 'macos' | 'linux';
/** Как ставить: скрипт одной командой, zip вручную, пакет npm */
type Way = 'script' | 'file' | 'npm';

const TARGETS: { id: string; os: Os; title: string }[] = [
  { id: 'win-x64', os: 'win', title: 'Windows' },
  { id: 'macos-arm64', os: 'macos', title: 'macOS (Apple M1–M4)' },
  { id: 'macos-x64', os: 'macos', title: 'macOS (Intel)' },
  { id: 'linux-x64', os: 'linux', title: 'Linux' },
];

function guessOs(): Os {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'win';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macos';
  return 'linux';
}

/** Где открыть терминал */
const TERMINAL: Record<Os, string> = {
  win: 'Откройте PowerShell: Win + X → «Терминал» (Windows 11) или «Windows PowerShell» (Windows 10).',
  macos: 'Откройте Терминал: Cmd + Пробел, наберите «Терминал», Enter.',
  linux: 'Откройте терминал.',
};

/** Куда ставит tfc install (cli/lib/install.mjs) */
const PLACE: Record<Os, string> = {
  win: '%LOCALAPPDATA%\\Programs\\tfc',
  macos: '~/.local/bin',
  linux: '~/.local/bin',
};

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} МБ`;

/** Команда с кнопкой «Копировать» */
function Cmd({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="tfc-dl-cmd">
      <pre>{text}</pre>
      <button
        className="btn sm"
        title="Копировать команду"
        onClick={() =>
          navigator.clipboard?.writeText(text).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          })
        }
      >
        {done ? <Check size={13} /> : <Copy size={13} />} {done ? 'Скопировано' : 'Копировать'}
      </button>
    </div>
  );
}

/** Блок «Программа tfc»: поставить для своей ОС (командой, файлом или через npm) и три команды до обновлённой сборки */
export function TfcDownload() {
  const [info, setInfo] = useState<TfcVersion | null>(null);
  const [os, setOs] = useState<Os>(guessOs);
  const [way, setWay] = useState<Way>('script');
  useEffect(() => {
    fetch('/tfc/version.json', { cache: 'no-cache' })
      .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : null))
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);
  if (!info) return null; // программу ещё не выкладывали

  const site = window.location.origin;
  const targets = TARGETS.filter((t) => t.os === os && info.files[t.id]);
  const ways: [Way, string][] = [
    ['script', 'Одной командой'],
    ['file', 'Скачать файл'],
    ...(info.npm ? [['npm', 'Через npm'] as [Way, string]] : []),
  ];
  const current = ways.some(([w]) => w === way) ? way : 'script';
  return (
    <section className="upd-card tfc-dl">
      <header className="upd-card-head">
        <Terminal size={18} className="faint" />
        <div className="grow">
          <h2>Программа tfc — сборка на вашем ПК</h2>
          <div className="faint small">
            Докачивает моды, конфиги, скрипты KubeJS и ресурспаки сборки и убирает устаревшие. Ваши моды и правки не
            трогает. Версия {info.version}.
          </div>
        </div>
      </header>
      <div className="tfc-dl-os">
        {(['win', 'macos', 'linux'] as Os[]).map((o) => (
          <button key={o} className={cx('btn', o === os && 'primary')} onClick={() => setOs(o)}>
            {{ win: 'Windows', macos: 'macOS', linux: 'Linux' }[o]}
          </button>
        ))}
        <span className="tfc-dl-sep" />
        {ways.map(([w, title]) => (
          <button key={w} className={cx('btn sm', w === current && 'primary')} onClick={() => setWay(w)}>
            {title}
          </button>
        ))}
      </div>
      <ol className="tfc-dl-steps">
        {current === 'script' && (
          <li>
            {TERMINAL[os]} Вставьте команду и нажмите Enter:
            <Cmd text={os === 'win' ? `irm ${site}/tfc/install.ps1 | iex` : `curl -fsSL ${site}/tfc/install.sh | sh`} />
            <span className="faint small">
              Скачает программу, поставит её в <code>{PLACE[os]}</code> и пропишет в PATH. Права администратора не
              нужны.
            </span>
          </li>
        )}
        {current === 'file' && (
          <>
            <li>
              Скачайте и распакуйте:{' '}
              {targets.map((t) => (
                <a key={t.id} className="btn" href={`/tfc/${info.files[t.id].file}`} download>
                  <Download size={14} /> {t.title} <span className="faint">· {mb(info.files[t.id].size)}</span>
                </a>
              ))}
            </li>
            {os === 'win' ? (
              <li>
                Запустите <code>tfc.exe</code> двойным кликом и нажмите Enter — программа поставит себя в{' '}
                <code>{PLACE.win}</code> и пропишет в PATH. Если Windows скажет «защитила компьютер» — «Подробнее» →
                «Выполнить в любом случае»: у файла нет платной подписи. Скачанный файл потом можно удалить.
              </li>
            ) : (
              <li>
                {TERMINAL[os]} Если распаковали не в «Загрузки», вместо <code>~/Downloads/tfc</code> перетащите файл в
                окно терминала.
                <Cmd
                  text={
                    os === 'macos'
                      ? 'xattr -d com.apple.quarantine ~/Downloads/tfc\n~/Downloads/tfc install'
                      : 'chmod +x ~/Downloads/tfc\n~/Downloads/tfc install'
                  }
                />
                <span className="faint small">
                  {os === 'macos' && 'Первая команда снимает запрет macOS на файл из интернета. '}
                  Программа встанет в <code>{PLACE[os]}</code> и пропишется в PATH.
                </span>
              </li>
            )}
          </>
        )}
        {current === 'npm' && info.npm && (
          <li>
            Если у вас уже стоит Node.js 20 или новее (
            <a href="https://nodejs.org" target="_blank" rel="noreferrer">
              nodejs.org
            </a>
            ). {TERMINAL[os]}
            <Cmd text={`npm install -g ${site}/tfc/${info.npm.file}`} />
            <span className="faint small">
              Пакет весит меньше мегабайта: программа работает на вашем Node.js.
              {os !== 'win' && ' Если npm пишет про права (EACCES) — та же команда через sudo.'}
            </span>
          </li>
        )}
        <li>
          Откройте <b>новое</b> окно терминала. Ключ попросите у хоста сборки. Дальше — три команды (закройте игру перед
          последней):
          <pre>
            {`tfc init            # найдёт папку игры и мир, спросит, какую взять
tfc login tfc_…     # ваш ключ
tfc pull            # докачать и обновить сборку`}
          </pre>
          <span className="faint small">
            Потом, при каждом обновлении сборки, — только <code>tfc pull</code>. Посмотреть, что изменится, ничего не
            трогая: <code>tfc status</code>. Вернуть как было: <code>tfc undo</code>. Новая версия программы —{' '}
            <code>tfc --upgrade</code>. Не ставили, а запускаете файл из папки — пишите{' '}
            <code>{os === 'win' ? '.\\tfc.exe' : './tfc'}</code> вместо <code>tfc</code>.
          </span>
          <p className="faint small" style={{ margin: '6px 0 0' }}>
            Сборки ещё нет совсем — одна команда <code>tfc init --launcher</code>: поставит NeoForge и версию
            TFC-RealWorld с отдельной папкой игры в <code>.minecraft/versions</code> (её видят и официальный Minecraft
            Launcher — профиль «TFC RealWorld», и TLauncher) и скачает сборку (спросит ключ и память). Лаунчер до этого
            запустите хотя бы раз, а перед установкой закройте.
          </p>
        </li>
      </ol>
    </section>
  );
}
