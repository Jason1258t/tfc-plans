#!/usr/bin/env bash
# Выпуск: ресурсы → сборка → проверка клемм → jar и иконки рядом с исходниками (в git); на сайт их кладёт сборка сайта (scripts/addons-index.mjs), версию — addon.json.
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
# Иконки для сайта (icons/) — общим генератором MCP (сглаживание, те же правила, что у model_render); 192 px — сайт
# показывает их 96 px, на экранах с двойной плотностью — пиксель в пиксель
ICONS="compact_kinetic_generator three_phase_rectifier single_phase_rectifier heavy_three_phase_rectifier heavy_single_phase_rectifier
  three_phase_inverter single_phase_inverter heavy_three_phase_inverter heavy_single_phase_inverter bidirectional_converter four_core_termination
<<<<<<< HEAD
  duplex_cable_insulator four_core_cable_insulator four_core_cable_spool four_core_tap
  copper_busbar_spool power_cable_spool stranded_copper_spool acsr_spool aluminum_spool bronze_spool steel_spool tension_clamp
  three_phase_frequency_converter single_phase_frequency_converter heavy_three_phase_frequency_converter heavy_single_phase_frequency_converter
  industrial_three_phase_frequency_converter three_phase_synchronizer single_phase_synchronizer heavy_three_phase_synchronizer
  heavy_single_phase_synchronizer industrial_three_phase_synchronizer"
=======
  duplex_cable_insulator four_core_cable_insulator four_core_cable_spool four_core_tap electric_lantern
  copper_busbar_spool power_cable_spool stranded_copper_spool acsr_spool aluminum_spool bronze_spool steel_spool tension_clamp"
>>>>>>> main
(cd ../.. && node scripts/mcp/render.mjs tools/ee-extras-mod $(printf 'ee_extras:%s ' $ICONS) --out tools/ee-extras-mod/icons --size 192)
echo "готово: ee-extras-$VERSION.jar → tools/ee-extras-mod; обновите addon.json и проверьте MCP addon_check"
