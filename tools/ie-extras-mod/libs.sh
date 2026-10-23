#!/usr/bin/env bash
# Библиотеки для компиляции и сервера разработки: TFC, Patchouli (нужен TFC) и Immersive Engineering из папки mods/
# сборки + вложенные в них. В мод не попадают — на сервере они уже стоят.
# MODS=<папка> — другая папка модов (например из git worktree).
set -euo pipefail
cd "$(dirname "$0")"
MODS="${MODS:-../../../../../mods}"
[ -d "$MODS" ] || MODS=../../mods
rm -rf libs && mkdir libs
for j in "$MODS"/TerraFirmaCraft-NeoForge-*.jar "$MODS"/Patchouli-*.jar "$MODS"/ImmersiveEngineering-*.jar; do
  cp "$j" libs/
  unzip -qq -o -j "$j" 'META-INF/jarjar/*.jar' -d libs/ 2>/dev/null || true
done
ls libs
