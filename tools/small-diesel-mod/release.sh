#!/usr/bin/env bash
# Выпуск: ресурсы → сборка → проверка клемм → jar рядом с исходниками (в git) и на сайт (public/addons, деплой хостинга).
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
mkdir -p ../../public/addons
cp "build/libs/small-diesel-$VERSION.jar" ../../public/addons/
# Иконки для сайта — общим генератором MCP (как у EE Extras)
(cd ../.. && node scripts/mcp/render.mjs tools/small-diesel-mod small_diesel:small_diesel_engine small_diesel:small_diesel_generator --out public/addons --size 192)
echo "готово: small-diesel-$VERSION.jar → tools/small-diesel-mod и public/addons"
