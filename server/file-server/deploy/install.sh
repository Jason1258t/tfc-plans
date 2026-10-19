#!/usr/bin/env bash
# Установка и обновление сервера файлов на Ubuntu 22.04 / 24.04. Запуск от root из папки server/file-server:
#   sudo bash deploy/install.sh files.example.com     — первая установка (домен — для HTTPS через Caddy)
#   sudo bash deploy/install.sh                        — обновление кода (настройки и файлы не трогает)
set -euo pipefail

DOMAIN="${1:-}"
APP=/opt/tfc-files
DATA=/var/lib/tfc-files
ENV_FILE=/etc/tfc-files.env
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

# Пользователь и папки
id tfcfiles >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin tfcfiles
mkdir -p "$APP" "$DATA"
chown tfcfiles:tfcfiles "$DATA"
chmod 750 "$DATA"

# Код
echo "→ Копирую сервер в $APP"
rm -rf "$APP/lib"
cp -r "$SRC/server.mjs" "$SRC/lib" "$SRC/package.json" "$APP/"

# Настройки — только при первой установке
if [ ! -f "$ENV_FILE" ]; then
  echo "→ Создаю $ENV_FILE"
  sed "s|^ADMIN_TOKEN=.*|ADMIN_TOKEN=$(openssl rand -hex 32)|" "$SRC/.env.example" > "$ENV_FILE"
  chown root:tfcfiles "$ENV_FILE"
  chmod 640 "$ENV_FILE"
fi

cp "$SRC/deploy/tfc-files.service" /etc/systemd/system/tfc-files.service
systemctl daemon-reload
systemctl enable tfc-files >/dev/null
systemctl restart tfc-files

# HTTPS через Caddy
if [ -n "$DOMAIN" ]; then
  if ! command -v caddy >/dev/null; then
    echo "→ Ставлю Caddy"
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update
    apt-get install -y caddy
  fi
  sed "s|^DOMAIN {|$DOMAIN {|" "$SRC/deploy/Caddyfile" > /etc/caddy/Caddyfile
  systemctl reload caddy || systemctl restart caddy
  if command -v ufw >/dev/null && ufw status | grep -q active; then
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
  fi
fi

sleep 1
systemctl --no-pager --lines=5 status tfc-files || true
echo
curl -fsS http://127.0.0.1:8787/health && echo
[ -n "$DOMAIN" ] && echo "Снаружи: https://$DOMAIN/health"
echo "Ключ администратора (для переезда файлов): sudo grep ADMIN_TOKEN $ENV_FILE"
