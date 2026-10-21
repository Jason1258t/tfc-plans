# Установка tfc на Windows одной командой (PowerShell):
#   irm https://tfc-plans-fd2c.web.app/tfc/install.ps1 | iex
# Скачивает tfc.exe с сайта во временную папку, сверяет контрольную сумму и запускает `tfc install`:
# тот ставит себя в %LOCALAPPDATA%\Programs\tfc и добавляет папку в PATH пользователя (без прав администратора).
# Копию этого файла сайт раздаёт из public/tfc/ (кладёт npm run tfc:dist).

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # полоса Invoke-WebRequest в PowerShell 5 замедляет загрузку в разы
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072 # TLS 1.2
$site = if ($env:TFC_SITE) { $env:TFC_SITE } else { 'https://tfc-plans-fd2c.web.app' }

$v = Invoke-RestMethod "$site/tfc/version.json" -Headers @{ 'Cache-Control' = 'no-cache' } -UseBasicParsing
$f = $v.files.'win-x64'
if (-not $f) { throw 'На сайте нет tfc для Windows' }

$tmp = Join-Path $env:TEMP ('tfc-install-' + [guid]::NewGuid())
New-Item -ItemType Directory $tmp | Out-Null
try {
  $zip = Join-Path $tmp $f.file
  Write-Host ("Скачиваю tfc {0} ({1} МБ)..." -f $v.version, [math]::Round($f.size / 1MB))
  Invoke-WebRequest "$site/tfc/$($f.file)" -OutFile $zip -UseBasicParsing
  if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $f.sha256) {
    throw 'Файл пришёл повреждённым (контрольная сумма не сошлась) — запустите команду ещё раз'
  }
  Expand-Archive $zip -DestinationPath $tmp
  & (Join-Path $tmp 'tfc.exe') install --yes
  if ($LASTEXITCODE -ne 0) { throw "tfc install завершился с ошибкой ($LASTEXITCODE)" }
  # В этом же окне tfc заработает сразу, не только в новом
  $dir = Join-Path $env:LOCALAPPDATA 'Programs\tfc'
  if ($env:TFC_INSTALL_DIR) { $dir = $env:TFC_INSTALL_DIR }
  if (-not (($env:Path -split ';') -contains $dir)) { $env:Path = "$env:Path;$dir" }
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
