#!/usr/bin/env bash
# Библиотеки для компиляции: Create, Create Diesel Generators и Electro Energetics из папки mods/ сборки + вложенные
# в них (catnip/ponder, flywheel, Registrate). В мод не попадают — на сервере они уже стоят.
# MODS=<папка> — другая папка модов (например из git worktree).
set -euo pipefail
cd "$(dirname "$0")"
MODS="${MODS:-../../mods}"
rm -rf libs && mkdir libs
for j in "$MODS"/create-1.21.1-*.jar "$MODS"/createdieselgenerators-*.jar "$MODS"/electroenergetics-*.jar; do
  cp "$j" libs/
  unzip -qq -o -j "$j" 'META-INF/jarjar/*.jar' -d libs/ 2>/dev/null || true
done
ls libs
