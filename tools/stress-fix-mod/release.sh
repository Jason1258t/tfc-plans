#!/usr/bin/env bash
# Выпуск: сборка → jar рядом с исходниками (в git) и на сайт (public/addons, деплой хостинга).
# Проверка на сервере разработки — отдельно: ./test-server.sh (три запуска, около полутора минут).
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
[ -d libs ] || ./libs.sh
./gradlew build -q --console=plain
VERSION=$(sed -n 's/^mod_version=//p' gradle.properties)
rm -f stress-fix-*.jar
cp "build/libs/stress-fix-$VERSION.jar" .
# В git worktree public/addons нет: сначала остальные аддоны из основной копии, иначе деплой их потеряет
MAIN=$(git rev-parse --path-format=absolute --git-common-dir)/..
if [ ! -d ../../public/addons ] && [ -d "$MAIN/public/addons" ]; then cp -r "$MAIN/public/addons" ../../public/; fi
mkdir -p ../../public/addons
cp "build/libs/stress-fix-$VERSION.jar" ../../public/addons/
echo "готово: stress-fix-$VERSION.jar → tools/stress-fix-mod и public/addons"
