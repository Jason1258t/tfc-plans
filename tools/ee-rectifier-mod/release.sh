#!/usr/bin/env bash
# Выпуск: ресурсы → сборка → проверка клемм → jar рядом с исходниками (в git) и на сайт (public/addons, деплой хостинга).
# Полная проверка на сервере — отдельно: ./test-server.sh (минута-две).
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
[ -d libs ] || ./libs.sh
python3 art/gen_assets.py
./gradlew build -q --console=plain
./check-nodes.sh
VERSION=$(sed -n 's/^mod_version=//p' gradle.properties)
rm -f ee-rectifier-*.jar
cp "build/libs/ee-rectifier-$VERSION.jar" .
mkdir -p ../../public/addons
cp "build/libs/ee-rectifier-$VERSION.jar" ../../public/addons/
(cd art && python3 preview.py ../../../public/addons >/dev/null)
echo "готово: ee-rectifier-$VERSION.jar → tools/ee-rectifier-mod и public/addons"
