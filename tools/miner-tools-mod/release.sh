#!/usr/bin/env bash
# Выпуск: текстура → сборка → jar рядом с исходниками (в git) и на сайт (public/addons, деплой хостинга) + иконка.
# Проверка на сервере разработки — отдельно: ./test-server.sh (около минуты).
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
[ -d libs ] || ./libs.sh
python3 art/gen_assets.py
./gradlew build -q --console=plain
VERSION=$(sed -n 's/^mod_version=//p' gradle.properties)
rm -f miner-tools-*.jar
cp "build/libs/miner-tools-$VERSION.jar" .
# В git worktree public/addons нет: сначала остальные аддоны из основной копии, иначе деплой их потеряет
MAIN=$(git rev-parse --path-format=absolute --git-common-dir)/..
if [ ! -d ../../public/addons ] && [ -d "$MAIN/public/addons" ]; then cp -r "$MAIN/public/addons" ../../public/; fi
mkdir -p ../../public/addons
cp "build/libs/miner-tools-$VERSION.jar" ../../public/addons/
(cd ../.. && node scripts/mcp/render.mjs tools/miner-tools-mod miner_tools:miner_belt --out public/addons --size 192)
echo "готово: miner-tools-$VERSION.jar → tools/miner-tools-mod и public/addons"
