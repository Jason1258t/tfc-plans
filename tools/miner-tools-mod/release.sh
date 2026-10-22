#!/usr/bin/env bash
# Выпуск: текстуры → сборка → jar и иконки рядом с исходниками (в git); на сайт их кладёт сборка сайта (scripts/addons-index.mjs), версию — addon.json.
# Проверка на сервере разработки — отдельно: ./test-server.sh (около минуты).
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
[ -d libs ] || ./libs.sh
python3 art/gen_assets.py
python3 art/gen_helmet.py
./gradlew build -q --console=plain
VERSION=$(sed -n 's/^mod_version=//p' gradle.properties)
rm -f miner-tools-*.jar
cp "build/libs/miner-tools-$VERSION.jar" .
(cd ../.. && node scripts/mcp/render.mjs tools/miner-tools-mod miner_tools:miner_belt miner_tools:miner_helmet --out tools/miner-tools-mod/icons --size 192)
echo "готово: miner-tools-$VERSION.jar → tools/miner-tools-mod; обновите addon.json и проверьте MCP addon_check"
