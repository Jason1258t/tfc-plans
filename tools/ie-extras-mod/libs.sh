#!/usr/bin/env bash
# Библиотеки для компиляции и сервера разработки: TFC, Patchouli (нужен TFC), Immersive Engineering, Create, WoodenCog из jar
# сборки + вложенные в них. В мод не попадают — на сервере они уже стоят.
# Jar сборки — из кеша снимка (npm run pack:fetch, ~/.cache/tfc-plans/pack/mods); MODS=<папка> — другая папка модов.
set -euo pipefail
cd "$(dirname "$0")"
MODS="${MODS:-${TFC_MODS_DIR:-${TFC_PACK_CACHE:-$HOME/.cache/tfc-plans/pack}/mods}}"
rm -rf libs && mkdir libs
# Create (+ вложенные Flywheel, Ponder, Registrate), WoodenCog — для нагрева чаши; Electro Energetics и EE Overheat —
# только для сервера разработки (нагреватель EE под чашей)
for j in "$MODS"/TerraFirmaCraft-NeoForge-*.jar "$MODS"/Patchouli-*.jar "$MODS"/ImmersiveEngineering-*.jar \
  "$MODS"/create-1.21.1-*.jar "$MODS"/woodencog-*.jar "$MODS"/electroenergetics-*.jar "$MODS"/ee-overheat-*.jar; do
  cp "$j" libs/
  unzip -qq -o -j "$j" 'META-INF/jarjar/*.jar' -d libs/ 2>/dev/null || true
done
ls libs
