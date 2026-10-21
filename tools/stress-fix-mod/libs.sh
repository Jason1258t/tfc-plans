#!/usr/bin/env bash
# Библиотеки для компиляции: Create из папки mods/ сборки + вложенные в него (catnip/ponder, flywheel, Registrate).
# В мод не попадают — на сервере они уже стоят. MODS=<папка> — другая папка модов (например из git worktree).
set -euo pipefail
cd "$(dirname "$0")"
MODS="${MODS:-../../mods}"
rm -rf libs && mkdir libs
for j in "$MODS"/create-1.21.1-*.jar; do
  cp "$j" libs/
  unzip -qq -o -j "$j" 'META-INF/jarjar/*.jar' -d libs/ 2>/dev/null || true
done
ls libs
