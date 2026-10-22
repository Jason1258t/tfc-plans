#!/usr/bin/env bash
# Выпуск: ресурсы → сборка → проверка клемм → jar и иконки рядом с исходниками (в git); на сайт их кладёт сборка сайта (scripts/addons-index.mjs), версию — addon.json.
# Проверка на сервере разработки — отдельно: ./test-server.sh (около двух минут).
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
[ -d libs ] || ./libs.sh
python3 art/gen_assets.py
./gradlew build -q --console=plain
./check-nodes.sh
VERSION=$(sed -n 's/^mod_version=//p' gradle.properties)
rm -f small-diesel-*.jar
cp "build/libs/small-diesel-$VERSION.jar" .
# Иконки для сайта (icons/) — общим генератором MCP (как у EE Extras)
(cd ../.. && node scripts/mcp/render.mjs tools/small-diesel-mod small_diesel:small_diesel_engine small_diesel:small_diesel_generator --out tools/small-diesel-mod/icons --size 192)
echo "готово: small-diesel-$VERSION.jar → tools/small-diesel-mod; обновите addon.json и проверьте MCP addon_check"
