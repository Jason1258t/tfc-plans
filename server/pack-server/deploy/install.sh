#!/usr/bin/env bash
# Установка и обновление сервера сборки на Ubuntu 22.04 / 24.04. Запуск от root из папки server/pack-server:
#   sudo bash deploy/install.sh pack.example.com     — первая установка (домен — для HTTPS через Caddy)
#   sudo bash deploy/install.sh                       — обновление кода (настройки, сборку и ключи не трогает)
# Порты 80/443 заняты — свой порт и сертификат через DuckDNS (см. server/common/caddy-site.sh):
#   sudo HTTPS_PORT=8443 DUCKDNS_TOKEN_FILE=/etc/tfc-pack/duckdns.token bash deploy/install.sh pack.duckdns.org
# Можно ставить рядом с сервером файлов: другая служба, другой порт, свой блок в Caddy.
set -euo pipefail

DOMAIN="${1:-}"
APP=/opt/tfc-pack
ENV_FILE=/etc/tfc-pack.env
SRC="$(cd "$(dirname "$0")/.." && pwd)"

[ "$(id -u)" = 0 ] || { echo "Запустите через sudo"; exit 1; }

# Node.js 22+ (из NodeSource, если системный старее)
NODE_MAJOR=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0)
if [ "${NODE_MAJOR:-0}" -lt 22 ]; then
  echo "→ Ставлю Node.js 22"
  apt-get update
  apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# git — сборка данных держит свою копию репозитория (код разборщиков)
command -v git >/dev/null || { apt-get update; apt-get install -y git; }

# Настройки — только при первой установке
if [ ! -f "$ENV_FILE" ]; then
  echo "→ Создаю $ENV_FILE"
  cp "$SRC/.env.example" "$ENV_FILE"
  chmod 640 "$ENV_FILE"
fi
# Настройки, появившиеся позже (сборка данных), — дописываем, если их нет; остальное не трогаем
grep -q '^BUILD_HEAP_MB=' "$ENV_FILE" || printf '\n# Лимит кучи процесса сборки данных, МБ\nBUILD_HEAP_MB=640\n' >> "$ENV_FILE"
if [ -f /etc/tfc-pack/firebase-sa.json ] && ! grep -q '^GOOGLE_APPLICATION_CREDENTIALS=' "$ENV_FILE"; then
  printf '\n# Сервисный ключ Firebase — публикация данных\nGOOGLE_APPLICATION_CREDENTIALS=/etc/tfc-pack/firebase-sa.json\n' >> "$ENV_FILE"
fi
DATA=$(sed -n 's/^DATA_DIR=//p' "$ENV_FILE" | tail -1)
DATA=${DATA:-/var/lib/tfc-pack}

# Пользователь и папки
id tfcpack >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin tfcpack
chown root:tfcpack "$ENV_FILE"
mkdir -p "$APP" "$DATA"
chown tfcpack:tfcpack "$DATA"
chmod 750 "$DATA"

# Код
echo "→ Копирую сервер в $APP"
rm -rf "$APP/lib"
cp -r "$SRC/server.mjs" "$SRC/cli.mjs" "$SRC/lib" "$SRC/package.json" "$APP/"

# Песочница службы пускает писать только в папку данных — если её перенесли, правим и службу
sed "s|/var/lib/tfc-pack|$DATA|" "$SRC/deploy/tfc-pack.service" > /etc/systemd/system/tfc-pack.service
systemctl daemon-reload
systemctl enable tfc-pack >/dev/null
systemctl restart tfc-pack

# Первый ключ администратора
NEW_KEY=""
if [ ! -s "$DATA/keys.json" ]; then
  echo "→ Создаю первый ключ администратора"
  NEW_KEY=$(cd "$APP" && sudo -u tfcpack env DATA_DIR="$DATA" node cli.mjs key add host --role admin | tail -1)
fi

# HTTPS через Caddy
[ -n "$DOMAIN" ] && bash "$SRC/../common/caddy-site.sh" tfc-pack "$SRC/deploy/Caddyfile" "$DOMAIN"

sleep 1
systemctl --no-pager --lines=5 status tfc-pack || true
echo
PORT=$(sed -n 's/^PORT=//p' "$ENV_FILE" | tail -1)
curl -fsS "http://127.0.0.1:${PORT:-8788}/health" && echo
if [ -n "$DOMAIN" ]; then
  P="${HTTPS_PORT:-443}"
  if [ "$P" = 443 ]; then echo "Снаружи: https://$DOMAIN/health"; else echo "Снаружи: https://$DOMAIN:$P/health"; fi
fi
if [ -n "$NEW_KEY" ]; then
  echo
  echo "Ключ администратора (сохраните — больше он нигде не показывается):"
  echo "  $NEW_KEY"
fi
