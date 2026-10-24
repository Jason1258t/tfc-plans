#!/usr/bin/env bash
# Библиотеки для компиляции: Create и Electro Energetics из jar сборки + вложенные в них (catnip/ponder, flywheel,
# Registrate). В мод не попадают — на сервере они уже стоят.
# Jar сборки — из кеша снимка (npm run pack:fetch, ~/.cache/tfc-plans/pack/mods); MODS=<папка> — другая папка модов.
set -euo pipefail
cd "$(dirname "$0")"
MODS="${MODS:-${TFC_MODS_DIR:-${TFC_PACK_CACHE:-$HOME/.cache/tfc-plans/pack}/mods}}"
rm -rf libs && mkdir libs
for j in "$MODS"/create-1.21.1-*.jar "$MODS"/electroenergetics-*.jar; do
  cp "$j" libs/
  unzip -qq -o -j "$j" 'META-INF/jarjar/*.jar' -d libs/ 2>/dev/null || true
done
ls libs
