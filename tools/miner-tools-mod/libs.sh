#!/usr/bin/env bash
# Библиотеки для компиляции: Curios (слоты пояса и головы) и GeckoLib (модель каски) из jar сборки. В мод
# не попадают — в сборке они уже стоят.
# Jar сборки — из кеша снимка (npm run pack:fetch, ~/.cache/tfc-plans/pack/mods); MODS=<папка> — другая папка модов.
set -euo pipefail
cd "$(dirname "$0")"
MODS="${MODS:-${TFC_MODS_DIR:-${TFC_PACK_CACHE:-$HOME/.cache/tfc-plans/pack}/mods}}"
rm -rf libs && mkdir libs
cp "$MODS"/curios-neoforge-*.jar "$MODS"/geckolib-neoforge-*.jar libs/
ls libs
