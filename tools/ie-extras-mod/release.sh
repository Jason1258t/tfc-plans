#!/usr/bin/env bash
# Выпуск: ресурсы → сборка → jar и иконки рядом с исходниками (в git); на сайт их кладёт сборка сайта (scripts/addons-index.mjs), версию — addon.json.
# Проверка на сервере разработки — отдельно: ./test-server.sh (около трёх минут).
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
[ -d libs ] || ./libs.sh
python3 art/gen_assets.py
./gradlew build -q --console=plain
VERSION=$(sed -n 's/^mod_version=//p' gradle.properties)
rm -f ie-extras-*.jar
cp "build/libs/ie-extras-$VERSION.jar" .
# Иконки для сайта (icons/) — общим генератором MCP
(cd ../.. && node scripts/mcp/render.mjs tools/ie-extras-mod ie_extras:analog_heater --out tools/ie-extras-mod/icons --size 192)
echo "готово: ie-extras-$VERSION.jar → tools/ie-extras-mod; обновите addon.json и проверьте MCP addon_check"
