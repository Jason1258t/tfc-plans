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
rm -f ee-extras-*.jar ee-rectifier-*.jar
cp "build/libs/ee-extras-$VERSION.jar" .
mkdir -p ../../public/addons
cp "build/libs/ee-extras-$VERSION.jar" ../../public/addons/
# Иконки для сайта — общим генератором MCP (сглаживание, те же правила, что у model_render)
ICONS="three_phase_rectifier single_phase_rectifier bidirectional_converter four_core_termination
  duplex_cable_insulator four_core_cable_insulator four_core_cable_spool"
(cd ../.. && node scripts/mcp/render.mjs tools/ee-extras-mod $(printf 'ee_extras:%s ' $ICONS) --out public/addons --size 256)
echo "готово: ee-extras-$VERSION.jar → tools/ee-extras-mod и public/addons"
