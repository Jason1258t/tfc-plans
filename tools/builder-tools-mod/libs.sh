#!/usr/bin/env bash
# Curios из снимка сборки, только для компиляции.
set -euo pipefail
cd "$(dirname "$0")"
MODS="${MODS:-${TFC_MODS_DIR:-${TFC_PACK_CACHE:-$HOME/.cache/tfc-plans/pack}/mods}}"
mkdir -p libs
cp "$MODS"/curios-neoforge-*.jar libs/
