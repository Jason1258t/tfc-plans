/**
 * `tfc install` / `tfc uninstall` — поставить собранный файл в систему: своя папка вместо «Загрузок» и PATH,
 * чтобы в любом терминале писать просто `tfc …`.
 *
 *   Windows       %LOCALAPPDATA%\Programs\tfc\tfc.exe, папка — в PATH пользователя (реестр HKCU\Environment)
 *   macOS, Linux  ~/.local/bin/tfc, папка — в PATH через файл настроек оболочки (~/.zshrc, ~/.bashrc, …)
 *
 * Права администратора не нужны: всё в папке пользователя. Свою папку можно задать TFC_INSTALL_DIR.
 * Тот же код вызывают установщики с сайта (cli/install/install.ps1, install.sh): скачали во временную папку →
 * `tfc install --yes`.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WIN = process.platform === 'win32';
const EXE = WIN ? 'tfc.exe' : 'tfc';
/** Метка строк, которые tfc install дописывает в файлы оболочки: по ней uninstall их и убирает */
const MARK = '# tfc install: программа сборки TFC';

export function installDir() {
  if (process.env.TFC_INSTALL_DIR) return path.resolve(process.env.TFC_INSTALL_DIR);
  if (WIN) return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'tfc');
  return path.join(os.homedir(), '.local', 'bin');
}

export const installedPath = () => path.join(installDir(), EXE);

const norm = (p) => {
  const r = path.resolve(p).replace(/[\\/]+$/, '');
  return WIN ? r.toLowerCase() : r;
};

/** Запущен ли tfc из папки установки */
export const isInstalled = () => norm(process.execPath) === norm(installedPath());

/** Есть ли папка в PATH этого процесса (новый терминал после установки увидит и добавленную) */
const inPath = (dir) =>
  (process.env.PATH || process.env.Path || '')
    .split(path.delimiter)
    .filter(Boolean)
    .some((p) => norm(p) === norm(dir));

// ---------------------------------------------------------------- Windows: PATH пользователя

/**
 * PATH пользователя — в реестре как есть, без раскрытия %USERPROFILE% и т. п. (иначе запись испортила бы чужие
 * пути), тип REG_EXPAND_SZ. После записи — пустая установка переменной через .NET: она рассылает окнам
 * WM_SETTINGCHANGE, и новые терминалы видят новый PATH без перезахода в Windows.
 */
function winPath(action, dir) {
  const ps = `
$ErrorActionPreference = 'Stop'
$k = 'HKCU:\\Environment'; $d = $env:TFC_DIR.TrimEnd('\\')
$p = (Get-Item $k).GetValue('Path', '', 'DoNotExpandEnvironmentNames')
$parts = @($p -split ';' | Where-Object { $_ })
$has = @($parts | Where-Object { $_.TrimEnd('\\') -ieq $d }).Count -gt 0
if ($env:TFC_ACTION -eq 'add') {
  if ($has) { 'present'; exit }
  $parts += $d
} else {
  if (-not $has) { 'absent'; exit }
  $parts = @($parts | Where-Object { $_.TrimEnd('\\') -ine $d })
}
Set-ItemProperty -Path $k -Name Path -Value ($parts -join ';') -Type ExpandString
[Environment]::SetEnvironmentVariable('TFC_PATH_REFRESH', '1', 'User')
[Environment]::SetEnvironmentVariable('TFC_PATH_REFRESH', $null, 'User')
'changed'`;
  // -EncodedCommand (UTF-16LE в base64): кавычки и обратные косые скрипта не ломаются при разборе командной строки
  const encoded = Buffer.from(ps, 'utf16le').toString('base64');
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    env: { ...process.env, TFC_DIR: dir, TFC_ACTION: action },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
}

// ---------------------------------------------------------------- macOS, Linux: файлы оболочки

/** Куда дописать PATH: файл, который читает оболочка пользователя при открытии терминала */
function shellFiles() {
  const home = os.homedir();
  const shell = path.basename(process.env.SHELL || '');
  if (shell === 'zsh') return [path.join(home, '.zshrc')];
  if (shell === 'fish') return [path.join(home, '.config', 'fish', 'conf.d', 'tfc.fish')];
  if (shell === 'bash')
    // Терминал macOS открывает login-оболочку: она читает .bash_profile, а не .bashrc
    return [path.join(home, process.platform === 'darwin' ? '.bash_profile' : '.bashrc')];
  return [path.join(home, '.profile')];
}

function shellLine(file, dir) {
  const home = os.homedir();
  const rel = dir.startsWith(`${home}/`) ? `$HOME/${path.relative(home, dir)}` : dir;
  if (file.endsWith('.fish')) return `set -gx PATH "${rel}" $PATH ${MARK}`;
  return `export PATH="${rel}:$PATH" ${MARK}`;
}

const readText = (f) => {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return null;
  }
};

/** Дописывает строку PATH; возвращает файлы, куда дописал */
function addShellPath(dir) {
  const changed = [];
  for (const f of shellFiles()) {
    const text = readText(f) ?? '';
    if (text.includes(MARK)) continue;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${shellLine(f, dir)}\n`);
    changed.push(f);
  }
  return changed;
}

function removeShellPath() {
  const home = os.homedir();
  const files = ['.zshrc', '.bashrc', '.bash_profile', '.profile', '.config/fish/conf.d/tfc.fish'];
  const changed = [];
  for (const rel of files) {
    const f = path.join(home, rel);
    const text = readText(f);
    if (!text?.includes(MARK)) continue;
    const rest = text
      .split('\n')
      .filter((l) => !l.includes(MARK))
      .join('\n');
    if (rel.endsWith('tfc.fish') && !rest.trim()) fs.rmSync(f);
    else fs.writeFileSync(f, rest);
    changed.push(f);
  }
  return changed;
}

// ---------------------------------------------------------------- установка

/**
 * Копирует запущенный файл в папку установки и добавляет её в PATH.
 * { path, same: запущена уже установленная копия, updated: заменил прежнюю, pathChange: 'already' | 'added' | 'manual', files: правленые файлы оболочки }
 */
export function install() {
  const dir = installDir();
  const dest = installedPath();
  const same = isInstalled();
  const updated = !same && fs.existsSync(dest);
  if (!same) {
    fs.mkdirSync(dir, { recursive: true });
    const fresh = `${dest}.new`;
    fs.copyFileSync(process.execPath, fresh);
    fs.chmodSync(fresh, 0o755);
    // Метку «скачано из интернета» с копии — иначе macOS не даст её запустить
    if (process.platform === 'darwin')
      try {
        execFileSync('xattr', ['-d', 'com.apple.quarantine', fresh], { stdio: 'ignore' });
      } catch {
        // метки не было
      }
    // Проверочный запуск: битая копия не заменит рабочую
    try {
      execFileSync(fresh, ['--version'], {
        env: { ...process.env, TFC_NO_UPDATE_CHECK: '1' },
        stdio: 'pipe',
        timeout: 30_000,
      });
    } catch (e) {
      fs.rmSync(fresh, { force: true });
      throw new Error(`копия в ${dir} не запустилась: ${e.message}`);
    }
    // Windows не даёт перезаписать запущенный exe (вдруг старая версия открыта в другом окне), но даёт переименовать
    if (WIN && updated) {
      fs.rmSync(`${dest}.old`, { force: true });
      fs.renameSync(dest, `${dest}.old`);
    }
    fs.renameSync(fresh, dest);
  }

  let pathChange = 'already';
  let files = [];
  if (WIN) {
    try {
      if (winPath('add', dir) === 'changed') pathChange = 'added';
    } catch (e) {
      pathChange = 'manual';
      files = [e.message.split('\n')[0]];
    }
  } else if (!inPath(dir)) {
    files = addShellPath(dir);
    pathChange = 'added';
  }
  return { path: dest, dir, same, updated, pathChange, files };
}

/** Убирает папку из PATH и сам файл. Настройки (ключ, профили) остаются */
export function uninstall() {
  const dir = installDir();
  const dest = installedPath();
  const files = WIN ? (winPath('remove', dir) === 'changed' ? ['PATH пользователя'] : []) : removeShellPath();
  let removed = false;
  if (fs.existsSync(dest)) {
    if (WIN && isInstalled()) {
      // Запущенный exe не удалить — уберёт отдельный процесс, когда этот завершится
      // Строка для cmd — как есть (windowsVerbatimArguments): экранирование Node \" cmd не понимает
      const del = `ping -n 3 127.0.0.1 >nul & del /f /q "${dest}" "${dest}.old" & rmdir "${dir}"`;
      spawn('cmd.exe', ['/d', '/s', '/c', `"${del}"`], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        windowsVerbatimArguments: true,
      }).unref();
    } else {
      fs.rmSync(dest, { force: true });
      fs.rmSync(`${dest}.old`, { force: true });
      if (WIN)
        try {
          fs.rmdirSync(dir);
        } catch {
          // в папке что-то ещё — оставляем
        }
    }
    removed = true;
  }
  return { path: dest, removed, files };
}
