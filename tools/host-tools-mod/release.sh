#!/usr/bin/env bash
# Выпуск: сборка → jar рядом с исходниками (в git его нет; на сервер сборки — tfc admin addon upload), версию — addon.json.
# Проверка — отдельно: ./test-client.sh (клиент разработки, около двух минут) и ./test-server.sh (выделенный сервер).
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
./gradlew build -q --console=plain
VERSION=$(sed -n 's/^mod_version=//p' gradle.properties)
rm -f host-tools-*.jar
cp "build/libs/host-tools-$VERSION.jar" .
echo "готово: host-tools-$VERSION.jar → tools/host-tools-mod; обновите addon.json и проверьте MCP addon_check"
