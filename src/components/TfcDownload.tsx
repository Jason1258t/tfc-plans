import { Download, Terminal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cx } from '../lib/util';

/** public/tfc/version.json — его пишет npm run tfc:dist */
interface TfcVersion {
  version: string;
  time: number;
  files: Record<string, { file: string; size: number; sha256: string }>;
}

type Os = 'win' | 'macos' | 'linux';

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

/** Как запускать программу из папки, куда её распаковали */
const RUN: Record<Os, { exe: string; prep?: string; where: string }> = {
  win: {
    exe: '.\\tfc.exe',
    where:
      'В папке с tfc.exe: правый клик по пустому месту → «Открыть в Терминале» (Windows 11) или Shift + правый клик → «Открыть окно PowerShell здесь» (Windows 10). Если Windows скажет «защитила компьютер» — «Подробнее» → «Выполнить в любом случае».',
  },
  macos: {
    exe: './tfc',
    prep: 'xattr -d com.apple.quarantine tfc',
    where:
      'Терминал: напишите cd, пробел, перетащите папку с tfc в окно, Enter. Первая команда снимает запрет macOS на файл из интернета.',
  },
  linux: { exe: './tfc', prep: 'chmod +x tfc', where: 'Терминал в папке с tfc.' },
};

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} МБ`;

/** Блок «Программа tfc»: скачать для своей ОС и три команды до обновлённой сборки */
export function TfcDownload() {
  const [info, setInfo] = useState<TfcVersion | null>(null);
  const [os, setOs] = useState<Os>(guessOs);
  useEffect(() => {
    fetch('/tfc/version.json', { cache: 'no-cache' })
      .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : null))
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);
  if (!info) return null; // программу ещё не выкладывали

  const run = RUN[os];
  const targets = TARGETS.filter((t) => t.os === os && info.files[t.id]);
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
      </div>
      <ol className="tfc-dl-steps">
        <li>
          Скачайте и распакуйте:{' '}
          {targets.map((t) => (
            <a key={t.id} className="btn" href={`/tfc/${info.files[t.id].file}`} download>
              <Download size={14} /> {t.title} <span className="faint">· {mb(info.files[t.id].size)}</span>
            </a>
          ))}
        </li>
        <li>
          {run.where}
          {run.prep && <pre>{run.prep}</pre>}
        </li>
        <li>
          Ключ попросите у хоста сборки. Дальше — три команды (закройте игру перед последней):
          <pre>
            {`${run.exe} init            # найдёт папку игры и мир, спросит, какую взять
${run.exe} login tfc_…     # ваш ключ
${run.exe} sync            # докачать и обновить сборку`}
          </pre>
          <span className="faint small">
            Потом, при каждом обновлении сборки, — только <code>{run.exe} sync</code>. Посмотреть, что изменится, ничего
            не трогая: <code>{run.exe} status</code>. Вернуть как было: <code>{run.exe} sync --undo</code>.
          </span>
        </li>
      </ol>
    </section>
  );
}
