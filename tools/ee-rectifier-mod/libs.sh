#!/usr/bin/env bash
# Библиотеки для компиляции: Create и Electro Energetics из папки mods/ сборки + вложенные в них (catnip/ponder,
# flywheel, Registrate). В мод не попадают — на сервере они уже стоят.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf libs && mkdir libs
for j in ../../mods/create-1.21.1-*.jar ../../mods/electroenergetics-*.jar; do
  cp "$j" libs/
  unzip -qq -o -j "$j" 'META-INF/jarjar/*.jar' -d libs/ 2>/dev/null || true
done
ls libs
