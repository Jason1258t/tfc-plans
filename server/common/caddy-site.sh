#!/usr/bin/env bash
# Сайт Caddy для одной службы «TFC Планы» — так, чтобы сервер файлов и сервер сборки уживались на одной машине.
#   bash caddy-site.sh <имя> <шаблон Caddyfile> <домен>
# Блок службы кладётся в /etc/caddy/conf.d/<имя>.caddy, главный /etc/caddy/Caddyfile только подключает conf.d.
# Ставит Caddy, если его нет. Чужие блоки в главном Caddyfile не стирает — дописывает import.
set -euo pipefail

NAME="$1"
TEMPLATE="$2"
DOMAIN="$3"
MAIN=/etc/caddy/Caddyfile
CONF_D=/etc/caddy/conf.d
IMPORT_LINE="import $CONF_D/*.caddy"
# Так начинался Caddyfile, который прежний install.sh сервера файлов записывал целиком
OLD_FILES_MARK='# Caddy сам получает и продлевает сертификат Let'

if ! command -v caddy >/dev/null; then
  echo "→ Ставлю Caddy"
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

mkdir -p "$CONF_D"
if ! grep -qxF "$IMPORT_LINE" "$MAIN" 2>/dev/null; then
  [ -f "$MAIN" ] && cp "$MAIN" "$MAIN.bak.$(date +%Y%m%d-%H%M%S)"
  if [ -f "$MAIN" ] && grep -q "^$OLD_FILES_MARK" "$MAIN"; then
    echo "→ Переношу сайт сервера файлов из $MAIN в $CONF_D/tfc-files.caddy"
    cp "$MAIN" "$CONF_D/tfc-files.caddy"
    echo "$IMPORT_LINE" > "$MAIN"
  elif [ ! -f "$MAIN" ] || grep -q '/usr/share/caddy' "$MAIN"; then
    # Стандартный Caddyfile из пакета (страница-заглушка на :80) — заменяем
    echo "$IMPORT_LINE" > "$MAIN"
  else
    echo "→ В $MAIN уже есть свои сайты — дописываю подключение $CONF_D"
    printf '\n%s\n' "$IMPORT_LINE" >> "$MAIN"
  fi
fi

sed "s|^DOMAIN {|$DOMAIN {|" "$TEMPLATE" > "$CONF_D/$NAME.caddy"
caddy validate --config "$MAIN" --adapter caddyfile >/dev/null || { echo "Caddy не принял настройки — смотрите вывод выше"; exit 1; }
systemctl reload caddy || systemctl restart caddy

if command -v ufw >/dev/null && ufw status | grep -q active; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi
