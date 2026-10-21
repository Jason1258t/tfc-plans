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
# Иконки для сайта — общим генератором MCP (сглаживание, те же правила, что у model_render); 192 px — сайт
# показывает их 96 px, на экранах с двойной плотностью — пиксель в пиксель
ICONS="three_phase_rectifier single_phase_rectifier bidirectional_converter four_core_termination
  duplex_cable_insulator four_core_cable_insulator four_core_cable_spool four_core_tap
  copper_busbar_spool power_cable_spool stranded_copper_spool acsr_spool aluminum_spool bronze_spool steel_spool tension_clamp"
(cd ../.. && node scripts/mcp/render.mjs tools/ee-extras-mod $(printf 'ee_extras:%s ' $ICONS) --out public/addons --size 192)
echo "готово: ee-extras-$VERSION.jar → tools/ee-extras-mod и public/addons"
