#!/usr/bin/env bash
# Сайт Caddy для одной службы «TFC Планы» — так, чтобы сервер файлов и сервер сборки уживались на одной машине.
#   bash caddy-site.sh <имя> <шаблон Caddyfile> <домен>
# Блок службы кладётся в /etc/caddy/conf.d/<имя>.caddy, главный /etc/caddy/Caddyfile только подключает conf.d.
# Ставит Caddy, если его нет. Чужие блоки в главном Caddyfile не стирает — дописывает import.
#
# Когда порты 80/443 на машине заняты (прокси, VPN):
#   HTTPS_PORT=8443                 — слушать HTTPS на этом порту (адрес сайта станет https://домен:8443)
#   DUCKDNS_TOKEN_FILE=/путь/к/файлу — сертификат через DNS-проверку DuckDNS: порт 80 не нужен вовсе.
#                                     Caddy доустанавливается с модулем caddy-dns/duckdns (caddy add-package).
# Без DUCKDNS_TOKEN_FILE сертификат выдаётся обычным способом — нужен свободный и открытый порт 80.
set -euo pipefail

NAME="$1"
TEMPLATE="$2"
DOMAIN="$3"
HTTPS_PORT="${HTTPS_PORT:-443}"
DUCKDNS_TOKEN_FILE="${DUCKDNS_TOKEN_FILE:-}"
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

if [ -n "$DUCKDNS_TOKEN_FILE" ]; then
  [ -s "$DUCKDNS_TOKEN_FILE" ] || { echo "Файл токена DuckDNS пуст или не найден: $DUCKDNS_TOKEN_FILE"; exit 1; }
  if ! caddy list-modules 2>/dev/null | grep -qx 'dns.providers.duckdns'; then
    echo "→ Доставляю в Caddy модуль DuckDNS (сборка с caddyserver.com)"
    caddy add-package github.com/caddy-dns/duckdns
    # Обновление пакета caddy через apt вернёт сборку без модуля — тогда запустите этот скрипт ещё раз
  fi
  # Токен — службе Caddy через переменную окружения, не в Caddyfile
  umask 027
  printf 'DUCKDNS_TOKEN=%s\n' "$(tr -d '[:space:]' < "$DUCKDNS_TOKEN_FILE")" > /etc/caddy/duckdns.env
  chown root:caddy /etc/caddy/duckdns.env
  mkdir -p /etc/systemd/system/caddy.service.d
  printf '[Service]\nEnvironmentFile=/etc/caddy/duckdns.env\n' > /etc/systemd/system/caddy.service.d/duckdns.conf
  systemctl daemon-reload
  umask 022
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

# Свой порт: Caddy не должен занимать 80 под переадресацию http → https (порт может быть чужим)
if [ "$HTTPS_PORT" != 443 ] && ! grep -q 'auto_https disable_redirects' "$MAIN"; then
  if head -1 "$MAIN" | grep -q '^{'; then
    echo "В $MAIN уже есть глобальные настройки — допишите в них «auto_https disable_redirects» вручную"
  else
    printf '{\n\tauto_https disable_redirects\n}\n\n%s\n' "$(cat "$MAIN")" > "$MAIN"
  fi
fi

ADDR="$DOMAIN"
if [ "$HTTPS_PORT" != 443 ]; then ADDR="$DOMAIN:$HTTPS_PORT"; fi
awk -v addr="$ADDR" -v duck="$DUCKDNS_TOKEN_FILE" '
  /^DOMAIN \{/ {
    print addr " {"
    if (duck != "") { print "\ttls {"; print "\t\tdns duckdns {env.DUCKDNS_TOKEN}"; print "\t}" }
    next
  }
  { print }' "$TEMPLATE" > "$CONF_D/$NAME.caddy"
caddy validate --config "$MAIN" --adapter caddyfile >/dev/null || { echo "Caddy не принял настройки — смотрите вывод выше"; exit 1; }
systemctl restart caddy

if command -v ufw >/dev/null && ufw status | grep -q active; then
  ufw allow "$HTTPS_PORT/tcp" >/dev/null
  if [ -z "$DUCKDNS_TOKEN_FILE" ]; then ufw allow 80/tcp >/dev/null; fi
fi
